import { documentEngineHarness, settleEngine } from '../../../test-utils/documentEngineHarness';
import type { CollectionState } from '../collections';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const resource = { collection: 'groups', id: 'g' };
const value = { userId: 'owner', title: 'Original', status: 'draft', flow: [], templates: [], createdAt: 'now', updatedAt: 'now' };
const metadata = { protocol: 1 as const, generation: 'g', revision: 1, deleted: false };

it('updates an already-open list when work is submitted offline, without changing confirmed rows', async () => {
  const harness = documentEngineHarness({ resource, value, metadata });
  const engine = harness.createBrowser({ withCollections: true }).engine;
  engine.setOnline(false); engine.setOwner('owner');
  const listener = jest.fn<void, [CollectionState]>();
  const stop = engine.watchCollection('groups', listener);
  await settleEngine();
  const editor = await engine.openEditor(resource, 'editor');
  await editor.commit(current => ({ ...current, title: 'Queued' }));
  await settleEngine();
  const state = listener.mock.calls.at(-1)![0];
  expect(state.snapshots[0].value?.title).toBe('Original');
  expect(state.documents?.[0]).toMatchObject({ value: { title: 'Queued' }, pending: true });
  expect((await engine.readCollection('groups')).documents?.[0].value?.title).toBe('Queued');
  expect(harness.transport.send).not.toHaveBeenCalled();
  stop(); const count = listener.mock.calls.length;
  await editor.commit(current => ({ ...current, title: 'Next' })); await settleEngine();
  expect(listener).toHaveBeenCalledTimes(count);
  engine.dispose();
});

it('restores queued creation in an incomplete offline list after restart and confirms it on reconnect', async () => {
  const harness = documentEngineHarness({ resource, value: null, metadata: null });
  let engine = harness.createBrowser({ withCollections: true }).engine;
  engine.setOnline(false); engine.setOwner('owner');
  const editor = await engine.createEditor(resource, 'creator');
  await editor.commit(() => value); await editor.close({ flush: false }); engine.dispose();
  engine = harness.createBrowser({ withCollections: true }).engine;
  engine.setOnline(false); engine.setOwner('owner');
  const listener = jest.fn<void, [CollectionState]>();
  engine.watchCollection('groups', listener); await settleEngine();
  expect(listener.mock.calls.at(-1)![0]).toMatchObject({ complete: false, freshness: 'unknown',
    documents: [{ resource, value, pending: true }] });
  expect(await engine.readCollection('groups')).toMatchObject({ complete: false, freshness: 'unknown',
    documents: [{ resource, value, pending: true }] });
  engine.setOnline(true); await engine.retry(); await settleEngine();
  const state = await engine.refreshCollection('groups');
  expect(state).toMatchObject({ complete: true, freshness: 'server', documents: [{ value, pending: false }] });
  expect(listener.mock.calls.at(-1)![0].documents?.[0]).toMatchObject({ value, pending: false });
  engine.dispose();
});

it('fences an old collection subscription when the owner changes', async () => {
  const harness = documentEngineHarness({ resource, value, metadata });
  const engine = harness.createBrowser({ withCollections: true }).engine;
  engine.setOnline(false); engine.setOwner('owner');
  const listener = jest.fn<void, [CollectionState]>();
  engine.watchCollection('groups', listener); await settleEngine();
  engine.setOwner('other'); const count = listener.mock.calls.length;
  const other = jest.fn<void, [CollectionState]>();
  engine.watchCollection('groups', other); await settleEngine();
  expect(listener).toHaveBeenCalledTimes(count);
  expect(other.mock.calls.at(-1)![0].documents).toEqual([]);
  engine.dispose();
});
