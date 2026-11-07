import { waitFor } from '@testing-library/react';

import { DataEngine } from '../engine';
import { editorIdentity } from '../editorIdentity';
import { liveSubmittedWork } from '../liveSubmittedWork';
import { recoveryHeldOpen } from '../openDocumentAnswers';
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
  let pausedCacheRead: Promise<void> | undefined;
  const pauseCacheReads = () => {
    let resume!: () => void;
    pausedCacheRead = new Promise<void>(resolve => { resume = resolve; });
    return () => { pausedCacheRead = undefined; resume(); };
  };
  const makeEngine = () => {
    const runtime = new DataEngineRuntime({ transport, journal: {
      list: async owner => clone([...entries.values()].filter(entry => entry.command.owner === owner)),
      put: async entry => { entries.set(entry.command.operationId, clone(entry)); },
      remove: async (_owner, id) => { entries.delete(id); },
    } });
    const onError = jest.fn();
    const engine = new DataEngine({ runtime, transport, commits: store, checkpoints,
      observer: new ResourceObserver({ transport, source: { listen: () => () => undefined } }),
      snapshots: { read: async (_owner, resource) => {
        await pausedCacheRead;
        const row = cached.get(resourceKey(resource)); return row && clone(row);
      },
        put: async (_owner, snapshot) => { cached.set(resourceKey(snapshot.resource), clone(snapshot)); } },
      operationId: () => `carry-${++sequence}`, onError });
    engine.setOnline(false); engine.setOwner('owner'); return { engine, onError };
  };
  return { rows, store, storage, cached, pauseCacheReads, checkpoints, source, transport, make, makeEngine, captures, created, refuse: () => { refuse = true; } };
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


describe('durable atomic carry into an existing council', () => {
  function existingTarget(s: ReturnType<typeof setup>) {
    const target: ResourceSnapshot = { resource: { collection: 'councils', id: 'next' },
      metadata: { protocol: 1, generation: 'target-generation', revision: 4, deleted: false },
      value: { ...s.created, title: 'Already prepared', topics: [{ id: 'already', title: 'Existing words', questions: [], options: [] }] } };
    s.rows.set('councils/next', clone(target)); s.cached.set('councils/next', clone(target));
    const to = new DataSession(target);
    to.edit({ ...target.value, topics: [...target.value!.topics as DocumentData[], ...s.created.topics as DocumentData[]] });
    return { target, captures: [s.captures[0], { editorId: 'existing-target-action', captured: to.checkpoint(), predecessorId: null }] };
  }

  it('durably owns both existing councils offline and resumes one command without replacing destination words', async () => {
    const s = setup(), { captures } = existingTarget(s), first = s.make();
    const saved = await first.queue.saveAtomic(captures);
    await first.queue.drain(false);
    expect(saved).toHaveLength(2);
    expect(saved.every(request => request.atomic?.kind === 'council-carry')).toBe(true);
    expect(s.transport.send).not.toHaveBeenCalled();
    first.close();
    const restarted = s.make();
    await restarted.queue.drain(true);
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    expect(s.rows.get('councils/next')?.value?.topics).toMatchObject([{ title: 'Existing words' }, { title: 'Unfinished matter' }]);
    expect(s.rows.get('councils/source')?.value?.topics).toMatchObject([{ carriedToCouncilId: 'next' }]);
    expect(jest.mocked(s.transport.send).mock.calls[0][0]).toMatchObject({ relation: 'council-carry' });
    expect(jest.mocked(s.transport.send).mock.calls[0][0]).not.toHaveProperty('edits.1.create');
    restarted.close();
  });

  it('shows both sides offline and reopens the same destination copy after restart', async () => {
    const s = setup(); existingTarget(s);
    const { engine } = s.makeEngine(), source = await engine.openEditor(s.source.resource, 'parent');
    const captured = await source.carryCouncilTopicToExisting('topic', 'next');
    expect(captured.value?.topics).toMatchObject([{ title: 'Existing words' }, { title: 'Unfinished matter' }]);
    const target = await engine.openEditor(captured.resource, 'target-page');
    expect(target.getState().checkpoint.draft?.topics).toEqual(captured.value?.topics);
    const ids = (await s.store.list('owner')).map(request => request.id);
    expect(ids).toHaveLength(2); engine.dispose();
    const restarted = s.makeEngine().engine, reopened = await restarted.openEditor(captured.resource, 'reopened-target');
    expect(reopened.getState().checkpoint.draft?.topics).toEqual(captured.value?.topics);
    expect((await s.store.list('owner')).map(request => request.id)).toEqual(ids);
    restarted.dispose();
  });

  it.each(['source', 'destination'] as const)('shows the saved carry in an already-open %s council on offline return', async side => {
    const s = setup(), { target } = existingTarget(s);
    const author = s.makeEngine().engine, reader = s.makeEngine().engine;
    try {
      const resource = side === 'source' ? s.source.resource : target.resource;
      const source = await author.openEditor(s.source.resource, editorIdentity('author-tab', s.source.resource, 'default', 'source-opening'));
      const mounted = await reader.openEditor(resource, editorIdentity('reader-tab', resource, 'default', 'reader-opening'));
      const initial = mounted.getState().checkpoint.confirmed;
      reader.setVisible(false);

      const submitted = await source.carryCouncilTopicToExisting('topic', 'next');
      const expected = side === 'source'
        ? [expect.objectContaining({ title: 'Unfinished matter', carriedToCouncilId: 'next' })]
        : [expect.objectContaining({ title: 'Existing words' }), expect.objectContaining({ title: 'Unfinished matter' })];
      expect(submitted.value?.topics).toHaveLength(2);
      const requests = await s.store.list('owner');
      expect(requests).toHaveLength(2);
      expect(requests[0].atomic).toEqual(requests[1].atomic);
      expect(s.transport.send).not.toHaveBeenCalled();

      reader.setVisible(true);
      await waitFor(() => expect(mounted.getState().checkpoint.draft?.topics).toEqual(expected));
      expect(mounted.getState().checkpoint.confirmed).toEqual(initial);
      expect(mounted.getState().actionResolutionRequired).toBe(true);
      expect(mounted.getState().savedIntentReplaceable).toBe(false);
      expect(s.rows.get(resourceKey(resource))).toEqual(initial);
    } finally { author.dispose(); reader.dispose(); }
  });

  it('rejects a live projection when the other saved participant is missing or belongs elsewhere', async () => {
    const s = setup(), { target } = existingTarget(s), { engine } = s.makeEngine();
    try {
      const source = await engine.openEditor(s.source.resource, 'source-parent');
      await source.carryCouncilTopicToExisting('topic', 'next');
      const requests = await s.store.list('owner');
      const checkpoint = new DataSession(target).checkpoint();
      const editor = editorIdentity('reader-tab', target.resource, 'default', 'opening');
      const participant = requests.find(request => request.baseline.resource.id === 'next')!;
      const primary = requests.find(request => request.id === request.atomic?.id)!;
      expect(liveSubmittedWork('owner', editor, checkpoint, requests)?.checkpoint.draft?.topics).toHaveLength(2);
      expect(liveSubmittedWork('owner', editor, checkpoint, [participant])).toBeNull();
      expect(liveSubmittedWork('owner', editor, checkpoint, [participant, { ...primary, owner: 'different-owner' }])).toBeNull();
    } finally { engine.dispose(); }
  });

  it('keeps unsaved words private when returning to the destination with a completed local carry', async () => {
    const s = setup(), { target } = existingTarget(s);
    const author = s.makeEngine().engine, reader = s.makeEngine().engine;
    try {
      const source = await author.openEditor(s.source.resource, 'source-parent');
      const mounted = await reader.openEditor(target.resource, 'already-open-destination');
      await mounted.edit({ ...target.value, title: 'Private destination words' });
      reader.setVisible(false);
      await source.carryCouncilTopicToExisting('topic', 'next');
      reader.setVisible(true);
      await waitFor(() => expect(reader.getPending()).toEqual([]));
      const checkpoint = mounted.getState().checkpoint;
      expect(checkpoint.draft?.title).toBe('Private destination words');
      expect(checkpoint.draft?.topics).toHaveLength(1);
      expect(checkpoint.pending).toEqual({});
    } finally { author.dispose(); reader.dispose(); }
  });

  it('rolls back both borrowed effects after an explicit whole-action discard, preserving later words', async () => {
    const s = setup(), { target } = existingTarget(s);
    const author = s.makeEngine().engine, reader = s.makeEngine().engine;
    try {
      const source = await author.openEditor(s.source.resource, 'author-source');
      const sourceReader = await reader.openEditor(s.source.resource, 'reader-source');
      const targetReader = await reader.openEditor(target.resource, 'reader-destination');
      reader.setVisible(false);
      await source.carryCouncilTopicToExisting('topic', 'next');
      reader.setVisible(true);
      await waitFor(() => expect(targetReader.getState().checkpoint.draft?.topics).toHaveLength(2));
      await waitFor(() => expect(sourceReader.getState().actionResolutionRequired).toBe(true));
      const shown = targetReader.getState().checkpoint.draft!;
      await targetReader.edit({ ...shown, title: 'Later private destination title' });

      s.refuse(); reader.setOnline(true); await reader.retry();
      const [action] = sourceReader.getActions();
      expect(action.delivery.canDiscard).toBe(true);
      expect(targetReader.getState().savedIntentReplaceable).toBe(false);
      await expect(targetReader.keepLocal()).rejects.toThrow();
      expect((await s.store.list('owner')).every(request => request.state === 'refused')).toBe(true);
      await sourceReader.discardAction(action.id);
      await waitFor(() => expect(targetReader.getState().checkpoint.draft?.topics).toHaveLength(1));
      expect(targetReader.getState().checkpoint.draft?.title).toBe('Later private destination title');
      expect((sourceReader.getState().checkpoint.draft?.topics as DocumentData[])[0]).not.toHaveProperty('carriedToCouncilId');
      expect(sourceReader.getState().actionResolutionRequired).toBe(false);
      expect(targetReader.getState().actionResolutionRequired).toBe(false);
      expect(s.rows.get('councils/source')).toEqual(s.source);
      expect(s.rows.get('councils/next')).toEqual(target);
    } finally { author.dispose(); reader.dispose(); }
  });

  it('follows another saved transfer on a second return while the first still waits for network', async () => {
    const s = setup(), { target } = existingTarget(s);
    (s.source.value!.topics as DocumentData[]).push({ id: 'second', title: 'Second matter', questions: [], options: [] });
    s.rows.set('councils/source', clone(s.source)); s.cached.set('councils/source', clone(s.source));
    const author = s.makeEngine().engine, reader = s.makeEngine().engine;
    try {
      const source = await author.openEditor(s.source.resource, 'author-source');
      const mounted = await reader.openEditor(target.resource, 'reader-destination');
      reader.setVisible(false);
      await source.carryCouncilTopicToExisting('topic', 'next');
      reader.setVisible(true);
      await waitFor(() => expect(mounted.getState().checkpoint.draft?.topics).toHaveLength(2));
      reader.setVisible(false);
      await source.carryCouncilTopicToExisting('second', 'next');
      reader.setVisible(true);
      await waitFor(() => expect(mounted.getState().checkpoint.draft?.topics).toMatchObject([
        { title: 'Existing words' }, { title: 'Unfinished matter' }, { title: 'Second matter' },
      ]));
      expect(mounted.getState().actionResolutionRequired).toBe(true);
      expect(s.transport.send).not.toHaveBeenCalled();
    } finally { author.dispose(); reader.dispose(); }
  });

  it('follows a carry after its own locally saved destination change without losing that change', async () => {
    const s = setup(), { target } = existingTarget(s);
    const author = s.makeEngine().engine, reader = s.makeEngine().engine;
    try {
      const source = await author.openEditor(s.source.resource, editorIdentity('author-tab', s.source.resource, 'default', 'source'));
      const mounted = await reader.openEditor(target.resource, editorIdentity('reader-tab', target.resource, 'default', 'target'));
      await mounted.commit(value => ({ ...value, title: 'Saved destination title' }));
      reader.setVisible(false);
      await source.carryCouncilTopicToExisting('topic', 'next');
      const requests = await s.store.list('owner');
      const prior = requests.find(request => !request.atomic)!;
      expect(requests.find(request => request.atomic && request.baseline.resource.id === 'next')?.predecessor).toBe(prior.id);

      reader.setVisible(true);
      await waitFor(() => expect(mounted.getState().checkpoint.draft).toMatchObject({
        title: 'Saved destination title', topics: [{ title: 'Existing words' }, { title: 'Unfinished matter' }],
      }));
      expect(mounted.getState().checkpoint.pending[prior.id]).toBeDefined();
      expect(mounted.getState().actionResolutionRequired).toBe(true);
      expect(s.transport.send).not.toHaveBeenCalled();
    } finally { author.dispose(); reader.dispose(); }
  });

  it('keeps an earlier refused destination Save when discarding only the dependent carry', async () => {
    const s = setup(), { target } = existingTarget(s);
    const author = s.makeEngine().engine, reader = s.makeEngine().engine;
    try {
      const source = await author.openEditor(s.source.resource, editorIdentity('author-tab', s.source.resource, 'default', 'source'));
      const mounted = await reader.openEditor(target.resource, editorIdentity('reader-tab', target.resource, 'default', 'target'));
      await mounted.commit(value => ({ ...value, title: 'Refused destination title' }));
      reader.setVisible(false);
      await source.carryCouncilTopicToExisting('topic', 'next');
      reader.setVisible(true);
      await waitFor(() => expect(mounted.getState().checkpoint.draft?.topics).toHaveLength(2));
      const prior = (await s.store.list('owner')).find(request => !request.atomic)!;

      s.refuse(); reader.setOnline(true); await reader.retry();
      await waitFor(async () => expect((await s.store.list('owner')).every(request => request.state === 'refused')).toBe(true));
      author.setVisible(true);
      await waitFor(() => expect(source.getActions()[0]?.delivery.canDiscard).toBe(true));
      await source.discardAction(source.getActions()[0].id);
      reader.setVisible(true);
      await waitFor(() => expect(mounted.getState().checkpoint.draft?.topics).toHaveLength(1));
      expect(mounted.getState().checkpoint.draft?.title).toBe('Refused destination title');
      expect(mounted.getState().checkpoint.pending[prior.id]).toBeDefined();
      expect(mounted.getState().result).toMatchObject({ kind: 'refused', operationId: prior.id });
      expect(mounted.getState().actionResolutionRequired).toBe(false);
      expect((await s.store.list('owner')).find(request => request.id === prior.id)?.state).toBe('refused');
      expect(s.rows.get(resourceKey(target.resource))).toEqual(target);
    } finally { author.dispose(); reader.dispose(); }
  });

  it('treats a council title refusal with different update times as the same visible decision', () => {
    const s = setup(), { target } = existingTarget(s);
    const session = new DataSession(target);
    const draft = { ...target.value, title: 'Refused words', updatedAt: 'first-capture' };
    session.edit(draft);
    session.registerCommit('refused-title', session.checkpoint().editGeneration, draft);
    const record = { owner: 'owner', editorId: 'earlier-tab', checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
    const open = { owner: 'owner', resource: target.resource, operationIds: ['refused-title'],
      draft: { ...draft, updatedAt: 'rebased-after-carry' }, councilRefusal: { confirmed: target, remoteCandidate: null } };
    expect(recoveryHeldOpen([record], [open])).toBe(true);
    expect(recoveryHeldOpen([record], [{ ...open, draft: { ...open.draft, title: 'Private later words' } }])).toBe(false);
    const differentBasis = { ...target, metadata: { ...target.metadata!, generation: 'a-new-council' } };
    expect(recoveryHeldOpen([{ ...record, checkpoint: { ...record.checkpoint, confirmed: differentBasis } }], [open])).toBe(false);
    const newer = { ...target, metadata: { ...target.metadata!, revision: target.metadata!.revision + 1 },
      value: { ...target.value, title: 'A newer stored title' } };
    const newerCopy = { ...record, checkpoint: { ...record.checkpoint, remoteCandidate: newer } };
    expect(recoveryHeldOpen([newerCopy], [open])).toBe(false);
    expect(recoveryHeldOpen([newerCopy], [{ ...open, councilRefusal: { confirmed: target, remoteCandidate: newer } }])).toBe(true);
  });

  it.each(['return', 'reopen'] as const)('shows one decision for the earlier refused title on %s after discarding the carry', async entry => {
    const s = setup(), { target } = existingTarget(s);
    const author = s.makeEngine().engine, writer = s.makeEngine().engine, reader = s.makeEngine().engine;
    try {
      const from = await author.openEditor(s.source.resource, editorIdentity('author-tab', s.source.resource, 'default', 'source'));
      const edited = await writer.openEditor(target.resource, editorIdentity('writer-tab', target.resource, 'default', 'target'));
      let mounted = await reader.openEditor(target.resource, editorIdentity('reader-tab', target.resource, 'default', 'target'));
      reader.setVisible(false);
      await edited.commit(value => ({ ...value, title: 'Refused destination title' }));
      await from.carryCouncilTopicToExisting('topic', target.resource.id);
      const saved = await s.store.list('owner');
      const prior = saved.find(request => !request.atomic)!;
      const transfer = saved.find(request => request.atomic && request.baseline.resource.id === target.resource.id)!;
      expect(transfer.predecessor).toBe(prior.id);
      writer.setVisible(true);
      await waitFor(() => expect(edited.getState().checkpoint.draft?.topics).toHaveLength(2));

      const stored = { ...target, metadata: { ...target.metadata!, revision: target.metadata!.revision + 1 },
        value: { ...target.value!, title: 'Stored destination title', independent: 'A field from the server' } };
      s.rows.set(resourceKey(target.resource), stored);
      s.cached.set(resourceKey(target.resource), stored);
      s.refuse();
      author.setOnline(true);
      await author.retry();
      await waitFor(async () => expect((await s.store.list('owner')).map(row => row.state)).toEqual(['refused', 'refused', 'refused']));
      expect(s.transport.send).toHaveBeenCalledTimes(1);
      writer.setVisible(true);
      writer.setOnline(true);
      await writer.retry(target.resource);
      await waitFor(() => expect(edited.getState().checkpoint.remoteCandidate ?? edited.getState().checkpoint.confirmed).toEqual(stored));

      await waitFor(() => expect(from.getActions()).toEqual([{
        id: transfer.atomic!.id, delivery: { phase: 'refused', code: 'atomic-predecessor-conflict', canDiscard: true },
      }]));
      await from.discardAction(transfer.atomic!.id);
      const after = await s.store.list('owner');
      expect(after.find(row => row.id === prior.id)?.state).toBe('refused');
      expect(after.filter(row => row.atomic).every(row => row.state === 'cancelled')).toBe(true);
      writer.setVisible(true);
      await waitFor(() => expect(edited.getState().checkpoint.draft).toMatchObject({
        title: 'Refused destination title', independent: 'A field from the server',
      }));
      expect(edited.getState().checkpoint.draft?.topics).toHaveLength(1);

      if (entry === 'reopen') {
        mounted.close({ flush: false });
        const resumeCache = s.pauseCacheReads();
        try {
          mounted = await reader.openEditor(target.resource, editorIdentity('reader-tab', target.resource, 'default', 'reopened'));
          expect(mounted.getState().checkpoint.draft?.title).toBe('Refused destination title');
        } finally { resumeCache(); }
        await waitFor(() => expect(mounted.getState().checkpoint.remoteCandidate ?? mounted.getState().checkpoint.confirmed).toEqual(stored));
      }
      reader.setVisible(true);
      await waitFor(() => expect(mounted.getState().result).toMatchObject({ kind: 'refused', operationId: prior.id }));
      expect(mounted.getState().checkpoint.draft?.title).toBe('Refused destination title');
      const drafts = (await reader.listRecoverable(target.resource)).filter(item => item.answer === 'refused').map(item => item.record);
      expect(drafts).toHaveLength(1);
      const scopes = reader.getOpenAnswerScopes();
      expect(recoveryHeldOpen(drafts, scopes)).toBe(true);
      const [draft] = drafts;
      expect(recoveryHeldOpen([{ ...draft, checkpoint: { ...draft.checkpoint,
        draft: { ...draft.checkpoint.draft, independent: 'Unseen private words' },
      } }], scopes)).toBe(false);
      expect(recoveryHeldOpen([{ ...draft, checkpoint: { ...draft.checkpoint,
        confirmed: target,
      } }], scopes)).toBe(false);
      const newer = { ...stored, metadata: { ...stored.metadata, revision: stored.metadata.revision + 1 },
        value: { ...stored.value, title: 'A newer stored title' } };
      expect(recoveryHeldOpen([{ ...draft, checkpoint: { ...draft.checkpoint, remoteCandidate: newer } }], scopes)).toBe(false);
      await mounted.acceptRemote();
      expect(mounted.getState().checkpoint.draft).toEqual(stored.value);
      expect(s.rows.get(resourceKey(s.source.resource))).toEqual(s.source);
      expect(s.rows.get(resourceKey(target.resource))).toEqual(stored);
      expect(s.transport.send).toHaveBeenCalledTimes(1);
    } finally { author.dispose(); writer.dispose(); reader.dispose(); }
  });

  it('keeps a later saved destination title as a draft after discarding its refused carry', async () => {
    const s = setup(), { target } = existingTarget(s);
    const author = s.makeEngine().engine, reader = s.makeEngine().engine;
    try {
      const source = await author.openEditor(s.source.resource, editorIdentity('author-tab', s.source.resource, 'default', 'source'));
      const mounted = await reader.openEditor(target.resource, editorIdentity('reader-tab', target.resource, 'default', 'target'));
      reader.setVisible(false);
      await source.carryCouncilTopicToExisting('topic', 'next');
      reader.setVisible(true);
      await waitFor(() => expect(mounted.getState().checkpoint.draft?.topics).toHaveLength(2));
      await mounted.commit(value => ({ ...value, title: 'Later saved destination title' }));
      const requests = await s.store.list('owner');
      const participant = requests.find(request => request.atomic && request.baseline.resource.id === 'next')!;
      const later = requests.find(request => !request.atomic)!;
      expect(later.predecessor).toBe(participant.id);

      s.refuse(); reader.setOnline(true); await reader.retry();
      author.setVisible(true);
      await waitFor(() => expect(source.getActions()[0]?.delivery.canDiscard).toBe(true));
      await source.discardAction(source.getActions()[0].id);
      reader.setVisible(true);
      await waitFor(() => expect(mounted.getState().checkpoint.pending).toEqual({}));
      expect(mounted.getState().checkpoint.draft).toMatchObject({
        title: 'Later saved destination title', topics: [{ title: 'Existing words' }],
      });
      expect(mounted.getState().checkpoint.dirty).toBe(true);
      expect(mounted.getState().actionResolutionRequired).toBe(false);
      expect(s.rows.get(resourceKey(target.resource))).toEqual(target);
      mounted.close();
      const choices = await reader.listRecoverable(target.resource);
      expect(choices.some(choice => choice.record.checkpoint.draft?.title === 'Later saved destination title')).toBe(true);
    } finally { author.dispose(); reader.dispose(); }
  });

  it('follows a third carry after only the first received an acknowledgement', async () => {
    const s = setup(), { target } = existingTarget(s);
    (s.source.value!.topics as DocumentData[]).push(
      { id: 'second', title: 'Second matter', questions: [], options: [] },
      { id: 'third', title: 'Third matter', questions: [], options: [] },
    );
    s.rows.set('councils/source', clone(s.source)); s.cached.set('councils/source', clone(s.source));
    const author = s.makeEngine().engine, reader = s.makeEngine().engine;
    const send = jest.mocked(s.transport.send).getMockImplementation()!;
    let unblock!: () => void;
    const barrier = new Promise<void>(resolve => { unblock = resolve; });
    let secondInFlight = false;
    jest.mocked(s.transport.send).mockImplementation(async command => {
      if (command.kind === 'relation' && command.relation === 'council-carry'
        && command.edits[0].afterTopics.some(topic => topic.id === 'second' && topic.carriedToCouncilId)) {
        secondInFlight = true;
        await barrier;
      }
      return send(command);
    });
    let delivery: Promise<unknown> | undefined;
    try {
      const source = await author.openEditor(s.source.resource, 'author-source');
      const mounted = await reader.openEditor(target.resource, 'reader-destination');
      reader.setVisible(false);
      await source.carryCouncilTopicToExisting('topic', 'next');
      await source.carryCouncilTopicToExisting('second', 'next');
      reader.setVisible(true);
      await waitFor(() => expect(mounted.getState().checkpoint.draft?.topics).toHaveLength(3));
      reader.setOnline(true);
      delivery = reader.retry().catch(() => undefined);
      await waitFor(() => expect(secondInFlight).toBe(true));
      await waitFor(() => expect(mounted.getState().checkpoint.confirmed.metadata?.revision).toBe(5));
      const waiting = mounted.getState().checkpoint;
      expect(waiting.draft?.topics).toHaveLength(3);
      expect(waiting.draft?.rev).toBe(1);
      expect(Object.values(waiting.pending)).toHaveLength(1);
      expect(Object.values(waiting.pending)[0].value?.rev).toBeUndefined();

      reader.setOnline(false);
      reader.setVisible(false);
      author.setVisible(true);
      await waitFor(() => expect(source.getState().checkpoint.confirmed.metadata?.revision).toBe(2));
      await source.carryCouncilTopicToExisting('third', 'next');
      reader.setVisible(true);
      await waitFor(() => expect(mounted.getState().checkpoint.draft?.topics).toMatchObject([
        { title: 'Existing words' }, { title: 'Unfinished matter' }, { title: 'Second matter' }, { title: 'Third matter' },
      ]));
      expect(mounted.getState().checkpoint.confirmed.metadata?.revision).toBe(5);
    } finally {
      unblock();
      await delivery;
      author.dispose(); reader.dispose();
    }
  });

  it('chains two carries to the same destination with distinct copy identities', async () => {
    const s = setup(); existingTarget(s);
    (s.source.value!.topics as DocumentData[]).push({ id: 'second', title: 'Second matter', questions: [], options: [] });
    s.rows.set('councils/source', clone(s.source)); s.cached.set('councils/source', clone(s.source));
    const { engine } = s.makeEngine(), source = await engine.openEditor(s.source.resource, 'parent');
    await source.carryCouncilTopicToExisting('topic', 'next');
    const second = await source.carryCouncilTopicToExisting('second', 'next');
    const requests = await s.store.list('owner'), targets = requests.filter(request => request.baseline.resource.id === 'next');
    expect(targets).toHaveLength(2); expect(targets[1].predecessor).toBe(targets[0].id);
    const topics = second.value!.topics as DocumentData[];
    expect(topics.map(topic => topic.title)).toEqual(['Existing words', 'Unfinished matter', 'Second matter']);
    expect(new Set(topics.map(topic => topic.id)).size).toBe(3);
    engine.setOnline(true); await engine.retry();
    expect(s.transport.send).toHaveBeenCalledTimes(2);
    expect(s.rows.get('councils/next')?.value?.topics).toEqual(topics);
    engine.dispose();
  });

  it('carries into a newly created council that is still queued offline', async () => {
    const s = setup();
    (s.source.value!.topics as DocumentData[]).push({ id: 'second', title: 'Second matter', questions: [], options: [] });
    s.rows.set('councils/source', clone(s.source)); s.cached.set('councils/source', clone(s.source));
    const { engine } = s.makeEngine(), source = await engine.openEditor(s.source.resource, 'parent');
    const first = await source.carryCouncilTopicToNew('topic', 'Next council');
    const second = await source.carryCouncilTopicToExisting('second', first.resource.id);
    expect(second.value?.topics).toMatchObject([{ title: 'Unfinished matter' }, { title: 'Second matter' }]);
    engine.setOnline(true); await engine.retry();
    expect(s.transport.send).toHaveBeenCalledTimes(2);
    expect(s.rows.get(resourceKey(first.resource))?.value?.topics).toHaveLength(2);
    engine.dispose();
  });

  it('preserves a saved destination predecessor and excludes its later unsent words', async () => {
    const s = setup(), { target } = existingTarget(s), { engine } = s.makeEngine();
    const destination = await engine.openEditor(target.resource, 'destination-parent');
    await destination.commit(value => ({ ...value, title: 'Saved destination title' }));
    await destination.edit({ ...destination.getState().checkpoint.draft, title: 'Unsent destination title' });
    destination.close();
    const source = await engine.openEditor(s.source.resource, 'source-parent');
    const carried = await source.carryCouncilTopicToExisting('topic', 'next');
    expect(carried.value?.title).toBe('Saved destination title');
    const requests = await s.store.list('owner'), predecessor = requests.find(request => !request.atomic)!;
    expect(requests.find(request => request.atomic && request.baseline.resource.id === 'next')?.predecessor).toBe(predecessor.id);
    engine.setOnline(true); await engine.retry();
    expect(s.rows.get('councils/next')?.value?.title).toBe('Saved destination title');
    engine.dispose();
  });

  it('discards both refused effects and preserves later unrelated destination words', async () => {
    const s = setup(); existingTarget(s);
    const { engine } = s.makeEngine(), source = await engine.openEditor(s.source.resource, 'source-parent');
    await source.carryCouncilTopicToExisting('topic', 'next');
    const target = await engine.openEditor({ collection: 'councils', id: 'next' }, 'target-parent');
    const draft = target.getState().checkpoint.draft!;
    await target.edit({ ...draft, title: 'Later title', topics: (draft.topics as DocumentData[]).map(topic => topic.id === 'already' ? { ...topic, summary: 'Later destination words' } : topic) });
    s.refuse(); engine.setOnline(true); await engine.retry();
    const action = source.getActions()[0]; expect(action.delivery.canDiscard).toBe(true);
    await source.discardAction(action.id);
    expect(source.getState().checkpoint.draft?.topics).toMatchObject([{ title: 'Unfinished matter' }]);
    expect((source.getState().checkpoint.draft!.topics as DocumentData[])[0]).not.toHaveProperty('carriedToCouncilId');
    expect(target.getState().checkpoint.draft).toMatchObject({ title: 'Later title', topics: [{ id: 'already', summary: 'Later destination words' }] });
    expect(target.getState().checkpoint.draft?.topics).toHaveLength(1);
    engine.dispose();
  });

  it('keeps words edited inside the copied topic recoverable when its refused carry is discarded', async () => {
    const s = setup(); existingTarget(s);
    const { engine } = s.makeEngine(), source = await engine.openEditor(s.source.resource, 'source-parent');
    await source.carryCouncilTopicToExisting('topic', 'next');
    const target = await engine.openEditor({ collection: 'councils', id: 'next' }, 'target-parent');
    const draft = target.getState().checkpoint.draft!;
    await target.edit({ ...draft, topics: (draft.topics as DocumentData[]).map(topic => topic.id === 'already' ? topic : { ...topic, summary: 'New words typed in the copy' }) });
    s.refuse(); engine.setOnline(true); await engine.retry();
    await source.discardAction(source.getActions()[0].id);
    expect(target.getState().checkpoint.draft?.topics).toMatchObject([{ id: 'already' }, { summary: 'New words typed in the copy' }]);
    expect(target.getState().checkpoint.conflicts.length).toBeGreaterThan(0);
    engine.dispose();
  });

  it.each(['foreign', 'deleted', 'held'])('refuses an unavailable %s destination before saving either effect', async variant => {
    const s = setup(), { target } = existingTarget(s);
    if (variant === 'foreign') target.value!.userId = 'another-owner';
    if (variant === 'deleted') { target.value = null; target.metadata!.deleted = true; }
    if (variant === 'held') target.value!.status = 'held';
    s.cached.set('councils/next', clone(target));
    const { engine } = s.makeEngine(), source = await engine.openEditor(s.source.resource, 'parent');
    await expect(source.carryCouncilTopicToExisting('topic', 'next')).rejects.toThrow();
    expect(await s.store.list('owner')).toEqual([]);
    expect((source.getState().checkpoint.draft!.topics as DocumentData[])[0]).not.toHaveProperty('carriedToCouncilId');
    engine.dispose();
  });

  it('refuses an ambiguous destination chain instead of selecting a guessed predecessor', async () => {
    const s = setup(), { target } = existingTarget(s), { engine } = s.makeEngine();
    const left = await engine.openEditor(target.resource, 'left'), right = await engine.openEditor(target.resource, 'right');
    await left.commit(value => ({ ...value, title: 'Left saved words' }));
    await right.commit(value => ({ ...value, title: 'Right saved words' }));
    await engine.retry();
    const before = await s.store.list('owner');
    const source = await engine.openEditor(s.source.resource, 'source-parent');
    await expect(source.carryCouncilTopicToExisting('topic', 'next')).rejects.toMatchObject({ code: 'resolve-version-first' });
    expect(await s.store.list('owner')).toEqual(before);
    expect((source.getState().checkpoint.draft!.topics as DocumentData[])[0]).not.toHaveProperty('carriedToCouncilId');
    engine.dispose();
  });

  it('replays a lost reply without appending the existing-destination copy twice', async () => {
    const s = setup(), { captures } = existingTarget(s), first = s.make();
    const send = jest.mocked(s.transport.send).getMockImplementation()!;
    jest.mocked(s.transport.send).mockImplementationOnce(async command => { await send(command); throw new Error('Lost reply'); });
    await first.queue.saveAtomic(captures); await first.queue.drain(true).catch(() => undefined);
    const command = jest.mocked(s.transport.send).mock.calls[0][0]; first.close();
    const restarted = s.make(); await restarted.queue.drain(true);
    expect(jest.mocked(s.transport.send).mock.calls[1][0]).toEqual(command);
    expect(s.rows.get('councils/next')?.value?.topics).toHaveLength(2);
    expect(s.rows.get('councils/next')?.metadata?.revision).toBe(5);
    restarted.close();
  });
});
