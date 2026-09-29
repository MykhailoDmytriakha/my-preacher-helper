import { documentEngineHarness, settleEngine } from '../../../test-utils/documentEngineHarness';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const resource = { collection: 'groups', id: 'wednesday' };
const value = { userId: 'owner', title: 'Wednesday group', status: 'draft', templates: [], flow: [], createdAt: 'now', updatedAt: 'now' };

/**
 * TWO TABS, BOTH OFFLINE, THE SAME FIELD (BUG-20260815-offline-queued-text-invisible-in-other-tabs).
 *
 * Each tab runs its own engine over one device's storage, and a tab opened earlier does not
 * hear the other tab's queued change. What must never happen is the old outbox's failure: the
 * later delivery quietly writing over the earlier one. Every command carries the revision it was
 * made from, so the second one to arrive meets a conflict and keeps its words.
 */
it('never lets two offline tabs overwrite one another without a conflict', async () => {
  const harness = documentEngineHarness({ resource, value, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  const tabA = harness.createBrowser().engine; tabA.setOnline(false); tabA.setOwner('owner');
  const tabB = harness.createBrowser().engine; tabB.setOnline(false); tabB.setOwner('owner');
  const inA = await tabA.openEditor(resource, 'tab-a');
  const inB = await tabB.openEditor(resource, 'tab-b');

  await inA.commit(current => ({ ...current, title: 'Written in tab A' }));
  await inB.commit(current => ({ ...current, title: 'Written in tab B' }));

  tabA.setOnline(true); await tabA.retry(); await settleEngine();
  tabB.setOnline(true); await tabB.retry(); await settleEngine(); await settleEngine();

  expect(harness.server.value?.title).toBe('Written in tab A');
  const other = inB.getState().checkpoint;
  expect(other.conflicts.length).toBeGreaterThan(0);
  expect(other.draft?.title).toBe('Written in tab B');
  tabA.dispose(); tabB.dispose();
});
