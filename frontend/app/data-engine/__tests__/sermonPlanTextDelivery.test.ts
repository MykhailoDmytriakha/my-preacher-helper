import { documentEngineHarness, settleEngine } from '../../../test-utils/documentEngineHarness';

import type { DocumentData } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

it('retires a known earlier plan edit captured in the same offline editor', async () => {
  const resource = { collection: 'sermons', id: 'sermon-1' };
  const outline = { introduction: [{ id: 'removed', text: 'Point to remove' }], main: [], conclusion: [] };
  const value: DocumentData = { userId: 'owner', title: 'Sermon', verse: 'John 1:1', date: '2026-11-06',
    thoughts: [], outline, planText: { removed: 'Previously saved words' } };
  const harness = documentEngineHarness({
    resource, value, metadata: { protocol: 1, generation: 'sermon-generation', revision: 1, deleted: false },
  });
  const { engine, dispose } = harness.createBrowser();
  try {
    engine.setOwner('owner');
    engine.setOnline(false);
    const editor = await engine.openEditor(resource, 'plan');
    await editor.commit(current => ({ ...current, planText: { removed: 'Earlier offline edit' } }));
    const removedOutline = { ...outline, introduction: [] };
    await editor.commit(current => ({ ...current, outline: removedOutline }));
    engine.setOnline(true);
    await engine.retry();
    await settleEngine();
    expect(harness.server.value?.outline).toEqual(removedOutline);
    expect(harness.server.value?.planText).toEqual({ removed: '' });
    expect(editor.getState().checkpoint.conflicts).toEqual([]);
  } finally { dispose(); }
});
