import { membershipEngineHarness } from '@test-utils/membershipEngineHarness';
import { settleEngine } from '@test-utils/documentEngineHarness';

import { prepareDomainCommand } from '../domainPolicy';
import type { CommandResult, DataCommand, DocumentData, ResourceRef, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const source: ResourceRef = { collection: 'studyNotes', id: 'legacy-source-note' };
const sermon: ResourceRef = { collection: 'sermons', id: 'legacy-linked-sermon' };
const postCancelSermon: ResourceRef = { collection: 'sermons', id: 'after-cancel-linked-sermon' };
const sourceValue: DocumentData = {
  userId: 'owner', title: 'Legacy source', content: 'Source words stay durable', scriptureRefs: [], tags: [], isDraft: false,
  createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z', type: 'note',
};
const sermonValue: DocumentData = {
  userId: 'owner', title: 'Legacy linked sermon', verse: 'John 3:16', date: '2026-10-31', thoughts: [], sourceNoteIds: [source.id],
  scratch: [{ id: 'legacy-source-scratch', text: 'Copied source words', createdAt: '2026-10-31', source: { noteId: source.id, heading: 'Legacy source' } }],
};

function holdSourceCreate(h: ReturnType<typeof membershipEngineHarness>) {
  const send = jest.mocked(h.transport.send);
  const realSend = send.getMockImplementation()!;
  let command: DataCommand | undefined;
  let finish!: (result: Awaited<ReturnType<typeof realSend>>) => void;
  const response = new Promise<Awaited<ReturnType<typeof realSend>>>(resolve => { finish = resolve; });
  let released = false;
  send.mockImplementation(async current => {
    if (current.kind === 'create' && current.resource.collection === source.collection && current.resource.id === source.id) {
      command = current;
      return response;
    }
    return realSend(current);
  });
  return {
    get command() { return command; },
    async release() {
      if (!command || released) return;
      const result = await realSend(command);
      released = true;
      finish(result);
      await settleEngine();
    },
  };
}

it('does not deliver a legacy journaled sermon create before its prepared source create is acknowledged', async () => {
  const h = membershipEngineHarness([]);
  let browser = h.createBrowser();
  const engine = browser.engine;
  engine.setOnline(false); engine.setOwner('owner');
  let draining: Promise<void> | undefined;
  const hold = holdSourceCreate(h);
  try {
    const sourceEditor = await engine.createEditor(source, 'legacy-source-create');
    await sourceEditor.commit(() => sourceValue);
    const sermonEditor = await engine.createEditor(sermon, 'legacy-sermon-create');
    await sermonEditor.commit(() => sermonValue);
    await engine.retry(); await settleEngine();

    const requests = await h.commits.list('owner');
    const sourceRequest = requests.find(request => request.baseline.resource.id === source.id)!;
    const sermonRequest = requests.find(request => request.baseline.resource.id === sermon.id)!;
    // Reconstruct the immutable command format written by older clients. Current clients correctly
    // leave the consumer unprepared while its source is pending, so this compatibility path seeds
    // the real native commit store with commands produced by the real domain policy.
    const sourcePreparation = prepareDomainCommand('owner', sourceRequest.id, sourceRequest.working, sourceRequest.intended);
    const sermonPreparation = prepareDomainCommand('owner', sermonRequest.id, sermonRequest.working, sermonRequest.intended);
    const sourceCommand = sourcePreparation.command;
    const sermonCommand = sermonPreparation.command;
    await h.commits.compareAndSet(sourceRequest, { ...sourceRequest, state: 'prepared', command: sourceCommand, submitted: sourcePreparation.submittedValue });
    await h.commits.compareAndSet(sermonRequest, { ...sermonRequest, state: 'prepared', command: sermonCommand, submitted: sermonPreparation.submittedValue });
    await h.runtime.submit(sourceCommand);
    await h.runtime.submit(sermonCommand);
    expect((await h.runtime.list()).find(entry => entry.command.operationId === sermonRequest.id))
      .toMatchObject({ state: 'queued', command: sermonCommand });

    browser.dispose(); await settleEngine();
    browser = h.createBrowser();
    browser.engine.setOnline(false); browser.engine.setOwner('owner');
    await browser.engine.retry(); await settleEngine();
    expect((await h.runtime.list()).find(entry => entry.command.operationId === sermonRequest.id))
      .toMatchObject({ state: 'queued', command: sermonCommand });

    browser.engine.setOnline(true);
    draining = browser.engine.retry(); void draining.catch(() => undefined);
    await settleEngine();
    expect(hold.command).toMatchObject({ kind: 'create', resource: source });
    expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.resource)).toEqual([source]);
    expect(h.read(source).value).toBeNull();
    expect(h.read(sermon).value).toBeNull();

    await hold.release(); await draining; await browser.engine.retry(); await settleEngine();
    expect(h.read(source).value).toMatchObject({ content: 'Source words stay durable' });
    expect(h.read(sermon).value).toMatchObject({ sourceNoteIds: [source.id], scratch: [{ source: { noteId: source.id }, text: 'Copied source words' }] });
    expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.resource)).toEqual([source, sermon]);
    await expectSuccessfulOrCollected(h, [sourceRequest.id, sermonRequest.id]);
  } finally {
    await hold.release(); await draining?.catch(() => undefined); browser.dispose();
  }
});

it('retries an unknown source create with the same operation and releases its linked consumer only after the real receipt ACK', async () => {
  const h = membershipEngineHarness([]);
  const browser = h.createBrowser();
  const engine = browser.engine;
  engine.setOnline(false); engine.setOwner('owner');
  let firstNetworkFailure = true;
  let sourceSendCount = 0;
  let releaseRetry!: (result: CommandResult) => void;
  let retryCommand: DataCommand | undefined;
  const actualSend = jest.mocked(h.transport.send).getMockImplementation()!;
  const retryResponse = new Promise<CommandResult>(resolve => { releaseRetry = resolve; });
  jest.mocked(h.transport.send).mockImplementation(async command => {
    if (command.kind === 'create' && command.resource.collection === source.collection && command.resource.id === source.id) {
      sourceSendCount += 1;
      if (sourceSendCount === 2) { retryCommand = command; return retryResponse; }
    }
    const result = await actualSend(command);
    if (firstNetworkFailure && command.kind === 'create' && command.resource.collection === source.collection && command.resource.id === source.id) {
      firstNetworkFailure = false;
      throw new Error('Connection lost after server applied the command');
    }
    return result;
  });
  try {
    const sourceEditor = await engine.createEditor(source, 'unknown-source-create');
    await sourceEditor.commit(() => sourceValue);
    const sermonEditor = await engine.createEditor(sermon, 'unknown-linked-sermon-create');
    await sermonEditor.commit(() => sermonValue);
    await engine.retry(); await settleEngine();
    const requests = await h.commits.list('owner');
    const sourceRequest = requests.find(request => request.baseline.resource.id === source.id)!;
    const sermonRequest = requests.find(request => request.baseline.resource.id === sermon.id)!;
    const sourcePreparation = prepareDomainCommand('owner', sourceRequest.id, sourceRequest.working, sourceRequest.intended);
    const sermonPreparation = prepareDomainCommand('owner', sermonRequest.id, sermonRequest.working, sermonRequest.intended);
    const sourceCommand = sourcePreparation.command;
    const sermonCommand = sermonPreparation.command;
    await h.commits.compareAndSet(sourceRequest, { ...sourceRequest, state: 'prepared', command: sourceCommand, submitted: sourcePreparation.submittedValue });
    await h.commits.compareAndSet(sermonRequest, { ...sermonRequest, state: 'prepared', command: sermonCommand, submitted: sermonPreparation.submittedValue });
    await h.runtime.submit(sourceCommand); await h.runtime.submit(sermonCommand);

    engine.setOnline(true);
    const firstDrain = engine.retry(); void firstDrain.catch(() => undefined);
    await settleEngine();
    if (!retryCommand) {
      const secondDrain = engine.retry(); void secondDrain.catch(() => undefined);
      await settleEngine();
      expect(retryCommand).toMatchObject({ operationId: sourceRequest.id, kind: 'create', resource: source });
      expect(jest.mocked(h.transport.send).mock.calls.filter(([command]) => command.resource.id === sermon.id)).toHaveLength(0);
      releaseRetry(await actualSend(retryCommand!));
      await Promise.all([firstDrain.catch(() => undefined), secondDrain.catch(() => undefined)]);
    } else {
      expect(sourceSendCount).toBe(2);
      expect(firstNetworkFailure).toBe(false);
      expect(retryCommand).toMatchObject({ operationId: sourceRequest.id, kind: 'create', resource: source });
      expect(jest.mocked(h.transport.send).mock.calls.filter(([command]) => command.resource.id === sermon.id)).toHaveLength(0);
      releaseRetry(await actualSend(retryCommand));
      await firstDrain.catch(() => undefined);
    }
    await settleEngine();
    expect(h.read(source).value).toMatchObject({ content: 'Source words stay durable' });
    const sourceCalls = jest.mocked(h.transport.send).mock.calls
      .map(([command]) => command).filter(command => command.resource.id === source.id);
    expect(sourceCalls.map(command => command.operationId)).toEqual([sourceRequest.id, sourceRequest.id]);
    expect((await h.runtime.list()).some(entry => entry.command.operationId === sourceRequest.id)).toBe(false);
    expect(h.read(sermon).value).toMatchObject({ sourceNoteIds: [source.id], scratch: [{ source: { noteId: source.id } }] });
    expect(jest.mocked(h.transport.send).mock.calls.filter(([command]) => command.resource.id === sermon.id)).toHaveLength(1);
    await expectSuccessfulOrCollected(h, [sourceRequest.id, sermonRequest.id]);
  } finally {
    if (retryCommand) releaseRetry(await actualSend(retryCommand));
    browser.dispose();
  }
});

it('propagates an actual terminal source-create refusal to its consumer while retaining both authored drafts', async () => {
  const analysisValue: DocumentData = { ...sourceValue, type: 'analysis', scriptureRefs: [{ id: 'ref-analysis', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 1, toVerse: 1 }],
    analysis: { bible: 'rst', words: 4, cuts: [], links: {}, relations: {} } };
  const duplicate: ResourceSnapshot = { resource: { collection: 'studyNotes', id: 'other-existing-analysis' }, value: { ...analysisValue, title: 'Already canonical' },
    metadata: { protocol: 1, generation: 'canonical-analysis', revision: 1, deleted: false } };
  const h = membershipEngineHarness([duplicate]);
  const browser = h.createBrowser();
  const engine = browser.engine;
  engine.setOnline(false); engine.setOwner('owner');
  try {
    const sourceEditor = await engine.createEditor(source, 'refused-source-create');
    await sourceEditor.commit(() => analysisValue);
    const sermonEditor = await engine.createEditor(sermon, 'refused-linked-sermon-create');
    await sermonEditor.commit(() => sermonValue);
    await engine.retry(); await settleEngine();
    const before = await h.commits.list('owner');
    const sourceRequest = before.find(request => request.baseline.resource.id === source.id)!;
    const sermonRequest = before.find(request => request.baseline.resource.id === sermon.id)!;
    expect(sourceRequest).toBeDefined();
    expect(sermonRequest).toBeDefined();
    engine.setOnline(true); await engine.retry(); await settleEngine();
    const after = await h.commits.list('owner');
    const refusedSource = after.find(request => request.id === sourceRequest.id)!;
    const refusedConsumer = after.find(request => request.id === sermonRequest.id)!;
    expect(refusedSource).toMatchObject({ state: 'refused', result: { kind: 'refused', code: 'analysis-exists' }, intended: analysisValue });
    expect(refusedConsumer).toMatchObject({ state: 'refused', result: { kind: 'refused', code: 'referenced-document-deleted' }, intended: sermonValue });
    expect(sourceEditor.getState().checkpoint.draft).toMatchObject({ content: 'Source words stay durable' });
    expect(sermonEditor.getState().checkpoint.draft).toMatchObject({ title: 'Legacy linked sermon', scratch: [{ text: 'Copied source words' }] });
    expect(h.read(sermon).value).toBeNull();

    await sourceEditor.acceptRemote();
    expect(h.read(source).value).toBeNull();
    const sourceSendCount = jest.mocked(h.transport.send).mock.calls.filter(([command]) => command.resource.id === source.id).length;
    const postCancelEditor = await engine.createEditor(postCancelSermon, 'consumer-after-source-create-cancel');
    const postCancelValue = { ...sermonValue, title: 'Consumer after cancelled source create' };
    await postCancelEditor.commit(() => postCancelValue);
    await engine.retry(); await settleEngine();
    engine.setOnline(true); await engine.retry(); await settleEngine();
    expect(jest.mocked(h.transport.send).mock.calls.filter(([command]) => command.resource.id === source.id)).toHaveLength(sourceSendCount);
    expect(h.read(source).value).toBeNull();
    expect(h.read(postCancelSermon).value).toBeNull();
    const postCancelRequest = (await h.commits.list('owner')).find(request => request.baseline.resource.id === postCancelSermon.id)!;
    expect(postCancelRequest).toMatchObject({ state: 'refused', result: { kind: 'refused', code: 'referenced-document-deleted' }, intended: postCancelValue });
    expect(postCancelEditor.getState().checkpoint.draft).toMatchObject({ title: postCancelValue.title, scratch: [{ text: 'Copied source words' }] });
  } finally { browser.dispose(); }
});

async function expectSuccessfulOrCollected(h: ReturnType<typeof membershipEngineHarness>, operationIds: string[]) {
  const requests = await h.commits.list('owner');
  for (const operationId of operationIds) {
    const request = requests.find(item => item.id === operationId);
    expect(request?.state === undefined || request.state === 'acknowledged').toBe(true);
    expect(request?.state).not.toBe('conflict');
    expect(request?.state).not.toBe('refused');
  }
  const entries = await h.runtime.list();
  expect(entries.filter(entry => operationIds.includes(entry.command.operationId))).toEqual([]);
}

it('does not resurrect a source edit explicitly cancelled by accepting the canonical remote source', async () => {
  const liveSource: ResourceSnapshot = { resource: source, value: sourceValue,
    metadata: { protocol: 1, generation: 'accepted-source-generation', revision: 1, deleted: false } };
  const h = membershipEngineHarness([liveSource]);
  const browser = h.createBrowser();
  const engine = browser.engine;
  engine.setOnline(false); engine.setOwner('owner');
  try {
    const sourceEditor = await engine.openEditor(source, 'cancelled-source-edit');
    await sourceEditor.commit(current => ({ ...current!, content: 'Edit explicitly declined' }));
    await engine.retry(); await settleEngine();
    const pending = (await h.commits.list('owner')).find(request => request.baseline.resource.id === source.id)!;
    const command = prepareDomainCommand('owner', pending.id, pending.working, pending.intended).command;
    expect(command).toMatchObject({ kind: 'update', resource: source, generation: 'accepted-source-generation' });
    await h.commits.compareAndSet(pending, { ...pending, state: 'prepared', command });
    h.replace({ resource: source, value: { ...sourceValue, content: 'Canonical source from the other session' },
      metadata: { protocol: 1, generation: 'accepted-source-generation', revision: 2, deleted: false } });
    engine.setOnline(true); await engine.retry(); await settleEngine();
    expect((await h.commits.list('owner')).find(request => request.baseline.resource.id === source.id)?.state).toBe('conflict');
    await sourceEditor.acceptRemote();
    expect((await h.commits.list('owner')).some(request => request.baseline.resource.id === source.id)).toBe(false);
    expect(sourceEditor.getState().checkpoint.draft?.content).toBe('Canonical source from the other session');

    engine.setOnline(false);
    const sermonEditor = await engine.createEditor(sermon, 'new-consumer-after-source-cancel');
    await sermonEditor.commit(() => sermonValue);
    await engine.retry(); await settleEngine();
    const sourceSendsBeforeNewConsumer = jest.mocked(h.transport.send).mock.calls.filter(([command]) => command.resource.id === source.id).length;
    engine.setOnline(true); await engine.retry(); await settleEngine();
    expect(jest.mocked(h.transport.send).mock.calls.filter(([command]) => command.resource.id === source.id)).toHaveLength(sourceSendsBeforeNewConsumer);
    expect(h.read(source).value?.content).toBe('Canonical source from the other session');
    expect(h.read(sermon).value).toMatchObject({ sourceNoteIds: [source.id] });
    expect((await h.commits.list('owner')).some(request => request.baseline.resource.id === source.id)).toBe(false);
  } finally { browser.dispose(); }
});
