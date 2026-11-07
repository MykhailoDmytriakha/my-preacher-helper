import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import { describeSync } from '../status';
import { recoveryHeldOpen } from '../openDocumentAnswers';

import type { DocumentData } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'councils', id: 'successor-council' };
const value: DocumentData = {
  userId: 'owner', title: 'Original words', status: 'preparing', topics: [],
  createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z',
};

async function setup({ beforeFinish = false } = {}) {
  const harness = documentEngineHarness({ resource, value, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } });
  const browser = harness.createBrowser();
  browser.engine.setOwner('owner');
  browser.engine.setOnline(false);
  const early = beforeFinish ? await browser.engine.openEditor(resource, 'early') : null;
  const source = await browser.engine.openEditor(resource, 'source');
  await source.commit(current => ({ ...current, status: 'held', heldAt: '2026-10-17T00:01:00.000Z' }));
  source.close({ flush: false });
  const reader = await browser.engine.openEditor(resource, 'reader');
  const action = await browser.engine.openEditor(resource, 'action');
  const undo = async () => {
    await action.commit(current => { const { heldAt: _heldAt, ...words } = current!; return { ...words, status: 'preparing' }; });
    action.close({ flush: false });
    await settleEngine();
  };
  return { harness, browser, reader, action, undo, early };
}

it('publishes a saved successor into an already-open editor before delivery', async () => {
  const { harness, browser, reader, undo } = await setup();
  expect(reader.getState().checkpoint.draft?.status).toBe('held');
  await undo();
  const state = reader.getState();
  expect(state.checkpoint.draft).toMatchObject({ status: 'preparing', title: 'Original words' });
  expect(state.checkpoint.draft).not.toHaveProperty('heldAt');
  expect(Object.keys(state.checkpoint.pending)).toHaveLength(2);
  expect(state.checkpoint.confirmed.value?.status).toBe('preparing');
  expect(harness.transport.send).not.toHaveBeenCalled();
  expect(describeSync(state, reader.getObservation(), reader.getDelivery()).canSave).toBe(false);
  browser.engine.setOnline(true); await browser.engine.retry(); await settleEngine();
  expect(harness.server.value?.status).toBe('preparing');
  expect(reader.getState().checkpoint.draft?.status).toBe('preparing');
  browser.dispose();
});

it('preserves private unsent words while showing a descendant status action', async () => {
  const { harness, browser, reader, undo } = await setup();
  await reader.edit({ ...reader.getState().checkpoint.draft, title: 'Private unsent words' });
  await undo();
  expect(reader.getState().checkpoint.draft).toMatchObject({ status: 'preparing', title: 'Private unsent words' });
  expect(describeSync(reader.getState(), reader.getObservation(), reader.getDelivery()).canSave).toBe(true);
  expect((await harness.commits.list('owner')).map(request => request.value?.title)).toEqual(['Original words', 'Original words']);
  browser.engine.setOnline(true); await browser.engine.retry(); await settleEngine();
  expect(harness.server.value?.title).toBe('Original words');
  expect(reader.getState().checkpoint.draft?.title).toBe('Private unsent words');
  await reader.save(); await browser.engine.retry(); await settleEngine();
  expect(harness.server.value).toMatchObject({ status: 'preparing', title: 'Private unsent words' });
  browser.dispose();
});

it('leaves a private competing status isolated instead of choosing a local winner', async () => {
  const { harness, browser, reader, undo } = await setup();
  await reader.edit({ ...reader.getState().checkpoint.draft, status: 'conducting' });
  await undo();
  expect(reader.getState().checkpoint.draft?.status).toBe('conducting');
  expect(Object.keys(reader.getState().checkpoint.pending)).toHaveLength(1);
  expect(reader.getState().checkpoint.remoteCandidate).toBeNull();
  expect((await harness.commits.list('owner'))).toHaveLength(2);
  browser.dispose();
});

it('does not import a chain into an editor that never held its predecessor', async () => {
  const { browser, early, undo } = await setup({ beforeFinish: true });
  await early!.edit({ ...early!.getState().checkpoint.draft, title: 'Independent private words' });
  await undo();
  expect(early!.getState().checkpoint.draft).toMatchObject({ status: 'preparing', title: 'Independent private words' });
  expect(early!.getState().checkpoint.pending).toEqual({});
  browser.dispose();
});

it('keeps a refused action visible beside private words and retires only its submitted delta', async () => {
  const { harness, browser, reader, action } = await setup();
  // Keep the actual encoded action ownership used by the public facade.
  const actionId = browser.editorId(resource, 'action');
  action.close({ flush: false });
  const ownedAction = await browser.engine.openEditor(resource, actionId);
  await reader.edit({ ...reader.getState().checkpoint.draft, title: 'Private words beside refused Undo' });
  await ownedAction.commit(current => { const { heldAt: _heldAt, ...words } = current!; return { ...words, status: 'preparing' }; });
  ownedAction.close({ flush: false });
  await settleEngine();
  const originalSend = jest.mocked(harness.transport.send).getMockImplementation()!;
  jest.mocked(harness.transport.send).mockImplementationOnce(originalSend).mockImplementationOnce(async command => ({
    kind: 'refused', operationId: command.operationId, code: 'permission-denied', message: 'Refused test Undo',
  }));
  browser.engine.setOnline(true); await browser.engine.retry(); await settleEngine();
  const requests = await harness.commits.list('owner');
  const refused = requests.find(request => request.state === 'refused')!;
  expect(refused).toBeDefined();
  const saved = (await browser.engine.listRecoverable(resource)).filter(item => item.record.editorId === actionId);
  expect(saved).toHaveLength(1);
  expect(recoveryHeldOpen(saved.map(item => item.record), browser.engine.getOpenAnswerScopes())).toBe(false);
  await browser.engine.takeStoredVersion(resource, [refused.id]); await settleEngine();
  expect(reader.getState().checkpoint.draft).toMatchObject({ status: 'held', title: 'Private words beside refused Undo' });
  expect(reader.getState().checkpoint.draft).toHaveProperty('heldAt');
  expect(reader.getState().checkpoint.pending).toEqual({});
  expect(describeSync(reader.getState(), reader.getObservation(), reader.getDelivery()).canSave).toBe(true);
  browser.dispose();
});

it.each(['list', 'editor', 'offline', 'cache failure'] as const)('keeps the chosen server version on a watched list before the feed replies (%s)', async surface => {
  const harness = documentEngineHarness({ resource, value, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } });
  let rejectChoiceCache = false;
  const browser = harness.createBrowser({ withCollections: true, beforeSnapshotWrite: async snapshot => {
    if (rejectChoiceCache && snapshot.metadata?.revision === 2) throw new Error('Choice cache refused the write');
  } });
  const { engine } = browser;
  engine.setOwner('owner'); engine.setOnline(true);
  const titles: unknown[] = [];
  const stop = engine.watchCollection(resource.collection, state => {
    titles.push(state.documents?.find(row => row.resource.id === resource.id)?.value?.title);
  });
  try {
    await engine.readCollection(resource.collection);
    await settleEngine();
    expect(titles.at(-1)).toBe('Original words');
    const editor = await engine.openEditor(resource, browser.editorId(resource));
    harness.silentRemote({ title: 'Saved on the other device' });
    await editor.edit({ ...value, title: 'Delayed local words' });
    await editor.save();
    await settleEngine(); await settleEngine();
    const conflict = (await harness.commits.list('owner')).find(request => request.state === 'conflict');
    expect(conflict?.result).toMatchObject({ kind: 'conflict', snapshot: harness.server });
    expect(titles.at(-1)).toBe('Delayed local words');
    if (surface === 'offline') {
      engine.setOnline(false);
      await settleEngine();
    }
    if (surface === 'cache failure') {
      rejectChoiceCache = true;
      await expect(engine.takeStoredVersion(resource, [conflict!.id])).rejects.toThrow('Choice cache refused the write');
      expect((await harness.commits.list('owner')).find(request => request.id === conflict!.id)?.state).toBe('conflict');
      expect(titles.at(-1)).toBe('Delayed local words');
      rejectChoiceCache = false;
    }
    const beforeChoice = titles.length;

    if (surface !== 'editor') {
      editor.close({ flush: false });
      expect(await engine.takeStoredVersion(resource, [conflict!.id])).toBe(1);
    } else {
      await editor.acceptRemote();
      editor.close({ flush: false });
    }
    await settleEngine();

    expect(titles.at(-1)).toBe('Saved on the other device');
    expect(titles.slice(beforeChoice)).not.toContain('Original words');
    expect(harness.server.value?.title).toBe('Saved on the other device');
    if (surface === 'offline') {
      const reopened = harness.createBrowser({ withCollections: true });
      reopened.engine.setOwner('owner'); reopened.engine.setOnline(false);
      try {
        const state = await reopened.engine.readCollection(resource.collection);
        expect(state.documents?.find(row => row.resource.id === resource.id)?.value?.title).toBe('Saved on the other device');
      } finally {
        reopened.dispose();
      }
    }
  } finally {
    stop(); browser.dispose();
  }
});
