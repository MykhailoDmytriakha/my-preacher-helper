import { waitFor } from '@testing-library/react';

import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { collectionDocumentViews } from '../collectionView';
import { createIndexedDbCommitStore } from '../commits.client';
import { editorIdentity } from '../editorIdentity';
import { DataEngine } from '../engine';
import { hardQuestionRankOpening } from '../hardQuestionRankOrder';
import { ResourceObserver } from '../observer';
import { DataEngineRuntime } from '../runtime';
import { planDataCommand } from '../serverRelations';
import { createTestEditorLeases, installStorageHarness } from './storageHarness';

import type { HardQuestionRankChange, HardQuestionRankWitness } from '../hardQuestionRankOrder';
import type { DocumentData, EngineTransport, JournalEntry, ResourceRef, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const owner = 'owner';
const collection = 'hardQuestions' as const;
const theme = { collection: 'hardQuestionThemes', id: 'theme' };
const group = { id: 'group', title: 'The group' };
const scope = { themeId: theme.id, groupId: group.id };
const initial = { a: 1000, b: 1000, c: 3000, d: 4000 };
const stamps = { createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z' };
const ref = (id: string) => ({ collection, id });
const words = (rank: number): DocumentData => ({ userId: owner, title: 'Question', rank, ...scope, ...stamps });
const key = (resource: ResourceRef) => resource.collection + '/' + resource.id;
const row = (resource: ResourceRef, value: DocumentData): ResourceSnapshot => ({
  resource, value, metadata: { protocol: 1, generation: resource.id + '-generation', revision: 1, deleted: false },
});
const witness = (id: string, rank: number): HardQuestionRankWitness => ({ id, opening: hardQuestionRankOpening(words(rank)) });
const edit = (id: string, before: number, rank: number): HardQuestionRankChange => ({ ...witness(id, before), rank });

function setup(ranks = initial) {
  installStorageHarness();
  const commits = createIndexedDbCommitStore(undefined, createTestEditorLeases());
  const cache = new Map(Object.entries(ranks).map(([id, rank]) => [key(ref(id)), row(ref(id), words(rank))]));
  cache.set(key(theme), row(theme, { userId: owner, title: 'Theme', groups: [group], rank: 1000, ...stamps }));
  const server = new Map(cache), journal = new Map<string, JournalEntry>();
  const read = async (resource: ResourceRef) => server.get(key(resource)) ?? { resource, value: null, metadata: null };
  let sequence = 0;
  const transport: EngineTransport = {
    read: jest.fn((_owner, resource) => read(resource)),
    send: jest.fn(async command => {
      const planned = await planDataCommand(command, await read(command.resource), {
        get: read, list: async name => [...server.values()].filter(item => item.resource.collection === name),
      });
      planned.writes.forEach(snapshot => server.set(key(snapshot.resource), snapshot));
      return planned.result.kind === 'acknowledged'
        ? { ...planned.result, relatedSnapshots: planned.writes.filter(item => key(item.resource) !== key(command.resource)) }
        : planned.result;
    }),
  };
  const createEngine = () => {
    const runtime = new DataEngineRuntime({ transport, journal: {
      list: async account => [...journal.values()].filter(entry => entry.command.owner === account),
      put: async entry => { journal.set(entry.command.operationId, entry); },
      remove: async (_account, id) => { journal.delete(id); },
    } });
    const engine = new DataEngine({ runtime, transport, commits, checkpoints: createIndexedDbCheckpoints(),
      observer: new ResourceObserver({ transport, source: { listen: () => () => undefined } }),
      snapshots: { read: async (_owner, resource) => cache.get(key(resource)),
        put: async (_owner, snapshot) => { cache.set(key(snapshot.resource), snapshot); } },
      operationId: () => 'operation-' + (++sequence),
    });
    engine.setOnline(false);
    engine.setOwner(owner);
    return engine;
  };
  return { commits, read, createEngine, transport, cache, server };
}

it('restarts with one pending reorder, then uses one receipt for the full new order', async () => {
  const s = setup();
  let engine = s.createEngine();
  try {
    await engine.reorderHardQuestionRows(collection, [edit('d', 4000, 2000), edit('b', 1000, 3000), edit('c', 3000, 4000)], [witness('a', 1000)], scope);
    const pending = await s.commits.list(owner);
    expect(pending).toHaveLength(3);
    expect(new Set(pending.map(request => request.atomic?.id)).size).toBe(1);
    expect(s.transport.send).not.toHaveBeenCalled();
    engine.dispose();
    engine = s.createEngine();
    engine.setOnline(true);
    await engine.retry();
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    expect((await s.read(ref('a'))).metadata?.revision).toBe(1);
    expect(await Promise.all(['a', 'd', 'b', 'c'].map(async id => (await s.read(ref(id))).value?.rank))).toEqual([1000, 2000, 3000, 4000]);
  } finally { engine.dispose(); }
});

it('lets an independently saved question title through after the order was refused', async () => {
  const s = setup(), engine = s.createEngine();
  try {
    await engine.reorderHardQuestionRows(collection, [edit('d', 4000, 2000), edit('b', 1000, 3000), edit('c', 3000, 4000)], [witness('a', 1000)], scope);
    const writer = await engine.openEditor(ref('d'), editorIdentity('test', ref('d'), 'action', 'words'));
    expect(writer.getState().checkpoint.draft?.rank).toBe(2000);
    await writer.commit(current => ({ ...current, title: 'Keep the words saved later' }));
    writer.close({ flush: false });
    s.server.set(key(ref('b')), row(ref('b'), words(2250)));
    engine.setOnline(true);
    await engine.retry();
    expect(s.transport.send).toHaveBeenCalledTimes(2);
    expect((await s.read(ref('d'))).value).toMatchObject({ rank: 4000, title: 'Keep the words saved later' });
    expect((await s.read(ref('c'))).value?.rank).toBe(3000);
    const displayed = collectionDocumentViews(owner, collection, [...s.cache.values()].filter(item => item.resource.collection === collection), await s.commits.list(owner));
    expect(displayed.find(item => item.resource.id === 'd')?.value).toMatchObject({ rank: 4000, title: 'Keep the words saved later' });
    const [id] = await engine.listRefusedHardQuestionOrders(theme.id);
    expect(id).toBeDefined();
    await engine.discardRefusedHardQuestionOrder(id);
    expect(await engine.listRefusedHardQuestionOrders(theme.id)).toEqual([]);
  } finally { engine.dispose(); }
});

it('waits for a pending rank on a read-only neighbor the user can already see', async () => {
  const s = setup({ ...initial, a: 5000 }), engine = s.createEngine();
  try {
    const writer = await engine.openEditor(ref('a'), editorIdentity('test', ref('a'), 'action', 'neighbor'));
    await writer.commit(current => ({ ...current, rank: 2000 }));
    writer.close({ flush: false });
    await engine.reorderHardQuestionRows(collection, [edit('d', 4000, 3000), edit('c', 3000, 4000)], [witness('a', 2000)], scope);
    expect(s.transport.send).not.toHaveBeenCalled();
    engine.setOnline(true);
    await engine.retry();
    expect(s.transport.send).toHaveBeenNthCalledWith(1, expect.objectContaining({ kind: 'update', resource: ref('a') }));
    expect(s.transport.send).toHaveBeenNthCalledWith(2, expect.objectContaining({ relation: 'hard-question-reorder',
      witnesses: [{ ...witness('a', 2000), generation: 'a-generation' }] }));
    expect((await s.read(ref('a'))).metadata?.revision).toBe(2);
    expect((await s.read(ref('d'))).value?.rank).toBe(3000);
  } finally { engine.dispose(); }
});

it('waits for the group removal that already put the questions in the ungrouped list', async () => {
  const s = setup(), engine = s.createEngine();
  try {
    const writer = await engine.openEditor(theme, editorIdentity('test', theme, 'action', 'remove-group'));
    await writer.commit(current => ({ ...current, groups: [] }));
    writer.close({ flush: false });
    await engine.reorderHardQuestionRows(collection, [edit('d', 4000, 2000), edit('b', 1000, 3000), edit('c', 3000, 4000)],
      [witness('a', 1000)], { themeId: theme.id, groupId: null });
    const actions = await s.commits.list(owner);
    const removal = actions.find(request => request.baseline.resource.id === theme.id);
    expect(actions.find(request => request.atomic?.id === request.id)?.atomic?.hardQuestionRankScopeRequests).toEqual([removal?.id]);
    engine.setOnline(true);
    await engine.retry();
    expect(s.transport.send).toHaveBeenNthCalledWith(1, expect.objectContaining({ resource: theme, kind: 'update' }));
    expect(s.transport.send).toHaveBeenNthCalledWith(2, expect.objectContaining({ relation: 'hard-question-reorder' }));
    expect((await s.read(ref('d'))).value?.rank).toBe(2000);
  } finally { engine.dispose(); }
});

it('returns each move independently when a follow-up move is based on a refused order', async () => {
  const s = setup(), engine = s.createEngine();
  try {
    await engine.reorderHardQuestionRows(collection, [edit('d', 4000, 2000), edit('b', 1000, 3000), edit('c', 3000, 4000)], [witness('a', 1000)], scope);
    await engine.reorderHardQuestionRows(collection, [edit('d', 2000, 3500)], [witness('b', 3000), witness('c', 4000)], scope);
    s.server.set(key(ref('b')), row(ref('b'), words(2250)));
    engine.setOnline(true);
    await engine.retry();
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    const ordered = await engine.listRefusedHardQuestionOrders(theme.id);
    expect(ordered).toHaveLength(2);
    await engine.discardRefusedHardQuestionOrder(ordered[0]);
    await engine.discardRefusedHardQuestionOrder(ordered[1]);
    expect(await engine.listRefusedHardQuestionOrders(theme.id)).toEqual([]);
    expect((await s.read(ref('d'))).value?.rank).toBe(4000);
  } finally { engine.dispose(); }
});

it('settles the refused order without discarding the separately conflicting title', async () => {
  const s = setup(), engine = s.createEngine();
  try {
    await engine.reorderHardQuestionRows(collection, [edit('d', 4000, 2000), edit('b', 1000, 3000), edit('c', 3000, 4000)], [witness('a', 1000)], scope);
    const writer = await engine.openEditor(ref('d'), editorIdentity('test', ref('d'), 'action', 'different-title'));
    await writer.commit(current => ({ ...current, title: 'My independent title' }));
    writer.close({ flush: false });
    s.server.set(key(ref('b')), row(ref('b'), words(2250)));
    s.server.set(key(ref('d')), row(ref('d'), { ...words(4000), title: 'A separate stored title' }));
    engine.setOnline(true);
    await engine.retry();
    const [returned] = await engine.listRefusedHardQuestionOrders(theme.id);
    const findWords = async () => (await s.commits.list(owner)).find(request => request.value?.title === 'My independent title');
    expect(await findWords()).toMatchObject({ state: 'conflict', settledHardQuestionRankPredecessor: true });
    await engine.discardRefusedHardQuestionOrder(returned);
    expect(await findWords()).toMatchObject({ state: 'conflict', value: { title: 'My independent title' } });
    expect(await engine.listRefusedHardQuestionOrders(theme.id)).toEqual([]);
    expect((await s.read(ref('d'))).value?.title).toBe('A separate stored title');
  } finally { engine.dispose(); }
});

it('saves a valid one-row repair without writing the dragged row or its other neighbor', async () => {
  const s = setup({ ...initial, c: 2000 }), engine = s.createEngine();
  try {
    await engine.reorderHardQuestionRows(collection, [edit('b', 1000, 3000)], [witness('a', 1000), witness('c', 2000)], scope);
    expect(await s.commits.list(owner)).toHaveLength(1);
    engine.setOnline(true);
    await engine.retry();
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    expect(await Promise.all(['a', 'b', 'c'].map(async id => (await s.read(ref(id))).metadata?.revision))).toEqual([1, 2, 1]);
    expect((await s.read(ref('b'))).value?.rank).toBe(3000);
    expect(await engine.listRefusedHardQuestionOrders()).toEqual([]);
  } finally { engine.dispose(); }
});

it('keeps a second refused placement visible in a mounted editor when the saved rank order is chosen', async () => {
  const s = setup(), engine = s.createEngine();
  try {
    const destination = { id: 'another-group', title: 'Another group' };
    const themeWithDestination = row(theme, { ...s.cache.get(key(theme))!.value, groups: [group, destination] });
    s.cache.set(key(theme), themeWithDestination);
    s.server.set(key(theme), themeWithDestination);
    await engine.reorderHardQuestionRows(collection, [edit('d', 4000, 2000), edit('b', 1000, 3000), edit('c', 3000, 4000)], [witness('a', 1000)], scope);
    const writer = await engine.openEditor(ref('d'), editorIdentity('test', ref('d'), 'action', 'move-group'));
    await writer.commit(current => ({ ...current, groupId: destination.id, rank: 1000 }));
    s.server.set(key(ref('b')), row(ref('b'), words(2250)));
    engine.setOnline(true);
    await engine.retry();
    const rejectedPlace = (await s.commits.list(owner)).find(request => request.value?.groupId === destination.id)!;
    await waitFor(() => expect(writer.getState().result).toMatchObject({ kind: 'refused', operationId: rejectedPlace.id }));
    const [returned] = await engine.listRefusedHardQuestionOrders(theme.id);
    await engine.discardRefusedHardQuestionOrder(returned);
    await waitFor(() => expect(writer.getState().checkpoint.pending[returned]).toBeUndefined());
    expect(writer.getState().result).toMatchObject({ kind: 'refused', operationId: rejectedPlace.id });
    expect(writer.getState().checkpoint.draft?.groupId).toBe(destination.id);
    writer.close({ flush: false });
  } finally { engine.dispose(); }
});
