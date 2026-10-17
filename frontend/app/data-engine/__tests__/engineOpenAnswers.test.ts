import { relationRebaseHarness } from '@test-utils/relationRebaseHarness';
import { editorIdentity } from '../editorIdentity';

import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'studyNotes', id: 'note' };
const value = { userId: 'owner', title: 'Note', content: 'Original', isDraft: false, type: 'note', scriptureRefs: [], tags: [],
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };

async function refusedEditor() {
  const harness = documentEngineHarness({ resource, value, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  const browser = harness.createBrowser();
  browser.engine.setOwner('owner');
  jest.mocked(harness.transport.send).mockImplementation(async command => ({ kind: 'refused', operationId: command.operationId, code: 'invalid-document' }));
  const editor = await browser.engine.openEditor(resource, editorIdentity('test-tab', resource, 'default', 'first'));
  await editor.edit({ ...value, content: 'Kept words' });
  await editor.save(); await settleEngine(); await settleEngine();
  expect(browser.engine.getPending().some(entry => entry.state === 'refused')).toBe(true);
  return Object.assign(harness, { browser, editor });
}

describe('open editors holding answered requests', () => {
  it('publishes one immutable resource and removes it when its last answering editor closes', async () => {
    const { browser, editor } = await refusedEditor();
    try {
      expect(browser.engine.getOpenAnswers()).toEqual([resource]);
      expect(await browser.engine.answerHeldOpen(resource)).toBe(true);
      expect(Object.isFrozen(browser.engine.getOpenAnswers())).toBe(true);
      expect(Object.isFrozen(browser.engine.getOpenAnswers()[0])).toBe(true);
      editor.close({ flush: false });
      expect(browser.engine.getOpenAnswers()).toEqual([]);
      expect(await browser.engine.answerHeldOpen(resource)).toBe(false);
    } finally { browser.dispose(); }
  });

  it('keeps the snapshot stable across typing and a second holder without redundant notifications', async () => {
    const { browser, editor } = await refusedEditor();
    try {
      const original = browser.engine.getOpenAnswers();
      const listener = jest.fn();
      const stop = browser.engine.subscribeOpenAnswers(listener);
      await editor.edit({ ...editor.getState().checkpoint.draft, title: 'Words typed after the refusal' });
      const second = await browser.engine.openEditor(resource, editorIdentity('test-tab', resource, 'default', 'second'));
      expect(browser.engine.getOpenAnswers()).toBe(original);
      second.close({ flush: false });
      expect(browser.engine.getOpenAnswers()).toBe(original);
      expect(listener).not.toHaveBeenCalled();
      stop(); editor.close({ flush: false });
      expect(listener).not.toHaveBeenCalled();
    } finally { browser.dispose(); }
  });

  it('retires every answering editor before publishing another account, and dispose remains safe', async () => {
    const { browser, editor } = await refusedEditor();
    const second = await browser.engine.openEditor(resource, editorIdentity('test-tab', resource, 'default', 'second'));
    const snapshots: Array<readonly typeof resource[]> = [];
    const stop = browser.engine.subscribeOpenAnswers(() => { snapshots.push(browser.engine.getOpenAnswers()); });
    expect(() => browser.engine.setOwner('next-owner')).not.toThrow();
    expect(browser.engine.getOpenAnswers()).toEqual([]);
    expect(snapshots).toEqual([[]]);
    expect(() => editor.getState()).toThrow();
    expect(() => second.getState()).toThrow();
    stop(); expect(() => browser.dispose()).not.toThrow();
  });
});


describe('open editors holding a request conflict after its relation ACK', () => {
  it.each(['series', 'studyMaterials'] as const)('publishes the answering %s editor without a failed transport receipt', async collection => {
    const h = await relationRebaseHarness(collection);
    try {
      expect((await h.commits.list('owner'))[0].state).toBe('conflict');
      expect([...h.journal.values()].map(entry => entry.state)).toEqual(['acknowledged']);
      expect(h.editor.getState().checkpoint.conflicts.length).toBeGreaterThan(0);
      expect(h.engine.getOpenAnswers()).toEqual([h.primary.resource]);
      expect(await h.engine.answerHeldOpen(h.primary.resource)).toBe(true);
      h.editor.close({ flush: false });
      expect(h.engine.getOpenAnswers()).toEqual([]);
    } finally { h.browser.dispose(); }
  });
});
