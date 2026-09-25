import { documentEngineHarness, settleEngine } from '../../../test-utils/documentEngineHarness';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const resource = { collection: 'groups', id: 'new-group' };
const value = { userId: 'owner', title: 'Explicitly created', status: 'draft', templates: [], flow: [], createdAt: 'now', updatedAt: 'now' };

it('opens a queued creation after navigation offline without adopting later unsubmitted typing', async () => {
  const harness = documentEngineHarness({ resource, value: null, metadata: null });
  const engine = harness.createBrowser().engine;
  engine.setOnline(false); engine.setOwner('owner');
  const creator = await engine.createEditor(resource, 'creation-modal');
  await creator.commit(() => value);
  await creator.edit({ ...value, title: 'Unsubmitted private fork' });
  await creator.close({ flush: false });
  const detail = await engine.openEditor(resource, 'detail-page');
  expect(detail.getState().checkpoint.draft).toEqual(value);
  expect(detail.getState().checkpoint.confirmed.value).toBeNull();
  expect(Object.keys(detail.getState().checkpoint.pending)).toHaveLength(1);
  await detail.commit(current => ({ ...current, description: 'Continued offline' }));
  engine.setOnline(true); await engine.retry(); await settleEngine();
  expect(harness.server.value).toMatchObject({ title: 'Explicitly created', description: 'Continued offline' });
  expect(jest.mocked(harness.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['create', 'update']);
  engine.dispose();
});

it('continues submitted updates after restart while leaving later unsent typing in its source fork', async () => {
  const harness = documentEngineHarness({ resource, value, metadata: { protocol: 1, generation: 'created', revision: 1, deleted: false } });
  let engine = harness.createBrowser().engine;
  engine.setOnline(false); engine.setOwner('owner');
  const editor = await engine.openEditor(resource, 'before-restart');
  await editor.commit(current => ({ ...current, title: 'Submitted A' }));
  await editor.commit(current => ({ ...current, title: 'Submitted B' }));
  await editor.edit({ ...value, title: 'Unsent C' });
  await editor.close({ flush: false }); engine.dispose();
  engine = harness.createBrowser().engine;
  engine.setOnline(false); engine.setOwner('owner');
  const reopened = await engine.openEditor(resource, 'after-restart');
  expect(reopened.getState().checkpoint.draft?.title).toBe('Submitted B');
  expect(reopened.getState().checkpoint.confirmed.value?.title).toBe('Explicitly created');
  await reopened.commit(current => ({ ...current, description: 'Follow-up' }));
  engine.setOnline(true); await engine.retry(); await settleEngine();
  expect(harness.server.value).toMatchObject({ title: 'Submitted B', description: 'Follow-up' });
  const recoverable = await engine.listRecoverable(resource);
  expect(recoverable.some(copy => copy.record.checkpoint.draft?.title === 'Unsent C')).toBe(true);
  engine.dispose();
});

it('does not choose a winner between submitted branches from two editor lifetimes', async () => {
  const harness = documentEngineHarness({ resource, value, metadata: { protocol: 1, generation: 'created', revision: 1, deleted: false } });
  const engine = harness.createBrowser().engine;
  engine.setOnline(false); engine.setOwner('owner');
  const first = await engine.openEditor(resource, 'first'), second = await engine.openEditor(resource, 'second');
  await first.commit(current => ({ ...current, title: 'First branch' }));
  await second.commit(current => ({ ...current, title: 'Second branch' }));
  await first.close({ flush: false }); await second.close({ flush: false });
  const third = await engine.openEditor(resource, 'third');
  expect(third.getState().checkpoint.draft?.title).toBe(value.title);
  expect(await engine.listRecoverable(resource)).toHaveLength(2);
  engine.dispose();
});

it('does not automatically promote an unsubmitted creation into an existing document', async () => {
  const harness = documentEngineHarness({ resource, value: null, metadata: null });
  const engine = harness.createBrowser().engine;
  engine.setOnline(false); engine.setOwner('owner');
  const creator = await engine.createEditor(resource, 'unsubmitted');
  await creator.edit(value); await creator.close({ flush: false });
  const reader = await engine.openEditor(resource, 'reader');
  expect(reader.getState().checkpoint.draft).toBeNull();
  expect(harness.transport.send).not.toHaveBeenCalled();
  expect(await engine.listRecoverable(resource)).toHaveLength(1);
  engine.dispose();
});
