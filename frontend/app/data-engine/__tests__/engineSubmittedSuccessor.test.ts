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
