import { waitFor } from '@testing-library/react';

import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { collectionDocumentViews } from '../collectionView';
import { createIndexedDbCommitStore } from '../commits.client';
import { DataEngine } from '../engine';
import { ResourceObserver } from '../observer';
import { DataEngineRuntime } from '../runtime';
import { planDataCommand } from '../serverRelations';
import { createTestEditorLeases, installStorageHarness } from './storageHarness';

import type { DocumentData, EngineTransport, JournalEntry, ResourceRef, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const owner = 'owner';
const theme = { collection: 'hardQuestionThemes', id: 'theme' };
const question = { collection: 'hardQuestions', id: 'theme' };
const next = { collection: 'hardQuestions', id: 'question-next' };
const timestamps = { createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z' };
const heading = { userId: owner, title: 'Theme', rank: 1000, ...timestamps };
const group = { id: 'first', title: 'A new group' };
const parallelGroup = { id: 'another', title: 'A separate group' };
const words = (groupId: string, title: string) => ({ userId: owner, title, themeId: theme.id, groupId, rank: 1000, ...timestamps });
const key = (resource: ResourceRef) => JSON.stringify(resource);
const snapshot = (value: DocumentData | null, generation?: string): ResourceSnapshot => ({
  resource: theme, value, metadata: generation ? { protocol: 1, generation, revision: value ? 1 : 2, deleted: !value } : null,
});

function setup(initial: ResourceSnapshot) {
  installStorageHarness();
  const commits = createIndexedDbCommitStore(undefined, createTestEditorLeases());
  const caches = new Map([[key(theme), initial]]), rows = new Map(caches);
  const journal = new Map<string, JournalEntry>();
  let operation = 0;
  const read = async (resource: ResourceRef): Promise<ResourceSnapshot> =>
    rows.get(key(resource)) ?? { resource, metadata: null, value: null };
  const transport: EngineTransport = {
    read: jest.fn((_owner, resource) => read(resource)),
    send: jest.fn(async command => {
      const planned = await planDataCommand(command, await read(command.resource), {
        get: read,
        list: async collection => [...rows.values()].filter(item => item.resource.collection === collection),
      });
      planned.writes.forEach(item => rows.set(key(item.resource), item));
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
    const instance = new DataEngine({ runtime, transport, commits, checkpoints: createIndexedDbCheckpoints(),
      observer: new ResourceObserver({ transport, source: { listen: () => () => undefined } }),
      snapshots: { read: async (_account, resource) => caches.get(key(resource)),
        list: async (_account: string, collection: string) => [...caches.values()].filter(item => item.resource.collection === collection),
        put: async (_account, item) => { caches.set(key(item.resource), item); } },
      operationId: () => 'action-' + (++operation),
    });
    instance.setOnline(false);
    instance.setOwner(owner);
    return instance;
  };
  return { createEngine, commits, transport, read, replace: (value: ResourceSnapshot) => rows.set(key(theme), value) };
}

it('recovers one queued action after restart and installs both copies over a separate first group', async () => {
  const s = setup(snapshot(heading, 'existing-theme'));
  let engine = s.createEngine();
  try {
    await engine.createHardQuestionWithGroup(question, words(group.id, 'A question'), { group });
    const captured = await s.commits.list(owner);
    expect(captured).toHaveLength(2);
    expect(captured[0].atomic).toEqual(captured[1].atomic);
    expect(captured[0].editorId).not.toBe(captured[1].editorId);
    expect(s.transport.send).not.toHaveBeenCalled();
    expect(collectionDocumentViews(owner, theme.collection, [snapshot(heading, 'existing-theme')], captured)[0].value?.groups).toEqual([group]);
    expect(collectionDocumentViews(owner, question.collection, [], captured)[0]).toMatchObject({ pendingGroupCreation: true });
    engine.dispose();
    engine = s.createEngine();
    s.replace({ ...snapshot({ ...heading, groups: [parallelGroup] }, 'existing-theme'),
      metadata: { protocol: 1, generation: 'existing-theme', revision: 2, deleted: false } });
    engine.setOnline(true);
    await engine.retry();
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    expect((await s.read(theme)).value?.groups).toEqual([parallelGroup, group]);
    expect((await s.read(question)).value?.groupId).toBe(group.id);
    expect(await engine.peekCached(theme)).toMatchObject({ value: { groups: [parallelGroup, group] } });
    expect(await engine.peekCached(question)).toMatchObject({ value: { groupId: group.id } });
  } finally { engine.dispose(); }
});

it('serializes two quick captures before a legacy theme gets a generation and reuses the visible name', async () => {
  const initial = snapshot(heading);
  const s = setup(initial), engine = s.createEngine();
  try {
    await Promise.all([
      engine.createHardQuestionWithGroup(question, words(group.id, 'First question'), { group }),
      engine.createHardQuestionWithGroup(next, words('second', 'Next question'), { group: { id: 'second', title: ' A NEW GROUP ' } }),
    ]);
    const requests = await s.commits.list(owner);
    const firstRoot = requests.find(request => request.baseline.resource.id === question.id && request.baseline.resource.collection === question.collection)!;
    const nextRoot = requests.find(request => request.baseline.resource.id === next.id)!;
    const peer = requests.find(request => request.id === nextRoot.atomic?.participants[1])!;
    expect(peer.predecessor).toBe(firstRoot.atomic?.participants[1]);
    expect(peer.hardQuestionGroupIntent).toEqual({ group, existing: true });
    expect(nextRoot.value).toMatchObject({ groupId: group.id, rank: 2000 });
    engine.setOnline(true);
    await engine.retry();
    expect(s.transport.send).toHaveBeenCalledTimes(2);
    expect((await s.read(theme)).value?.groups).toEqual([group]);
    expect((await s.read(next)).value).toMatchObject({ groupId: group.id, rank: 2000 });
  } finally { engine.dispose(); }
});

it('refuses two questions depending on a pending group whose theme is removed, keeping each draft separately', async () => {
  const initial = snapshot(heading, 'theme-generation');
  const s = setup(initial);
  let engine = s.createEngine();
  const selected = 'First question';
  const dependent = 'A second question';
  try {
    await engine.createHardQuestionWithGroup(question, words(group.id, selected), { group });
    await engine.createHardQuestionWithGroup(next, words(group.id, dependent));
    s.replace(snapshot(null, 'theme-generation'));
    engine.setOnline(true);
    await engine.retry();
    await waitFor(async () => expect(await engine.listRefusedHardQuestionGroups()).toMatchObject([
      { questionId: next.id, title: dependent, group: group.title }, { questionId: question.id, title: selected, group: group.title },
    ]));
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    expect((await s.read(question)).value).toBeNull();
    expect((await s.read(next)).value).toBeNull();
    expect(collectionDocumentViews(owner, question.collection, [], await s.commits.list(owner)).map(item => item.value)).toEqual([null, null]);

    engine.dispose();
    engine = s.createEngine();
    const [later, first] = await engine.listRefusedHardQuestionGroups();
    await expect(engine.discardRefusedHardQuestionGroup(first.id)).rejects.toMatchObject({ code: 'membership-stage-changed' });
    await engine.discardRefusedHardQuestionGroup(later.id);
    expect(await engine.listRefusedHardQuestionGroups()).toMatchObject([{ id: first.id, title: selected, group: group.title }]);
    await engine.discardRefusedHardQuestionGroup(first.id);
    expect(await engine.listRefusedHardQuestionGroups()).toEqual([]);
    expect(await s.commits.list(owner)).toEqual([]);
    expect((await s.read(theme)).value).toBeNull();
  } finally { engine.dispose(); }
});

it('recaptures only after the atomic storage rejects an expired predecessor reference', async () => {
  const s = setup(snapshot(heading, 'theme-generation')), engine = s.createEngine();
  try {
    await engine.createHardQuestionWithGroup(question, words(group.id, 'First question'), { group });
    const persist = jest.spyOn(s.commits, 'createBatch').mockRejectedValueOnce(
      Object.assign(new Error('Saved request reference changed'), { code: 'commit-reference-changed' }));
    await engine.createHardQuestionWithGroup(next, words(group.id, 'Second question'), undefined);
    expect(persist).toHaveBeenCalledTimes(2);
    expect((await s.commits.list(owner)).filter(request => request.baseline.resource.id === next.id)).toHaveLength(1);
  } finally { engine.dispose(); }
});

it.each([false, true])('appends the next question with a stale list, previous save acknowledged=%s', async acknowledged => {
  const s = setup(snapshot({ ...heading, groups: [group] }, 'theme-generation')), engine = s.createEngine();
  try {
    await engine.createHardQuestionWithGroup(question, words(group.id, 'First question'));
    if (acknowledged) {
      engine.setOnline(true);
      await engine.retry();
      expect(await s.commits.list(owner)).toEqual([]);
      expect(await engine.peekCached(question)).toMatchObject({ value: { rank: 1000 } });
      engine.setOnline(false);
    }
    // What a still-open list supplied before collection presentation caught up.
    await engine.createHardQuestionWithGroup(next, words(group.id, 'Second question'));
    const second = (await s.commits.list(owner)).find(request => request.baseline.resource.id === next.id);
    expect(second?.value).toMatchObject({ title: 'Second question', rank: 2000 });
    engine.setOnline(true);
    await engine.retry();
    expect((await s.read(question)).value?.rank).toBe(1000);
    expect((await s.read(next)).value?.rank).toBe(2000);
  } finally { engine.dispose(); }
});
