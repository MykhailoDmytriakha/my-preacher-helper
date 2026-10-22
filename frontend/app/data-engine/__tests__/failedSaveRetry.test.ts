import { documentEngineHarness, settleEngine } from '../../../test-utils/documentEngineHarness';

import { describeManualSync, describeSync, isSyncTrouble } from '../status';

import type { ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'studyNotes', id: 'failed-save-retry' };
const snapshot: ResourceSnapshot = {
  resource, value: { userId: 'owner', title: 'A note', content: 'Original words', tags: [], scriptureRefs: [], isDraft: false,
    createdAt: '2026-10-21', updatedAt: '2026-10-21' },
  metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false },
};
async function fixture() {
  const h = documentEngineHarness(snapshot), browser = h.createBrowser();
  browser.engine.setOnline(false); browser.engine.setOwner('owner');
  const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
  return { ...h, get server() { return h.server; }, browser, engine: browser.engine, editor };
}

describe('Retry after an explicit Save capture fails (BUG-20261020-retry-hides-failed-save)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it.each(['document Save', 'document commit', 'manual Save'] as const)('continues %s or keeps its unfinished failure visible', async mode => {
    const h = await fixture(), { engine, editor } = h;
    const form = mode === 'manual Save' ? editor.form('content', [['content']]) : null;
    try {
      if (form) { await form.begin(); await form.update(value => ({ ...value, content: 'Explicitly saved words' })); }
      else if (mode === 'document Save') await editor.edit({ ...editor.getState().checkpoint.draft, content: 'Explicitly saved words' });
      h.storage.writeFailure = true;
      const saving = form ? form.save() : mode === 'document Save' ? editor.save()
        : editor.commit(value => ({ ...value, content: 'Explicitly saved words' }));
      await expect(saving).rejects.toThrow('disk full');
      h.storage.writeFailure = false;
      expect(await h.commits.list('owner')).toEqual([]);
      if (form) await form.retry(); else await engine.retry(resource);
      await settleEngine();
      const parent = describeSync(editor.getState(), editor.getObservation(), editor.getDelivery());
      const status = form ? describeManualSync(form.getState(), editor.getState(), parent, null) : parent;
      const requests = await h.commits.list('owner');
      expect(form?.getState()?.value.content ?? editor.getState().checkpoint.draft?.content).toBe('Explicitly saved words');
      expect(requests.length > 0 || isSyncTrouble(status?.phase)).toBe(true);
      expect(requests).toHaveLength(1);
      expect(requests[0].value?.content).toBe('Explicitly saved words');
      engine.setOnline(true); await engine.retry(); await settleEngine();
      expect(h.server.value?.content).toBe('Explicitly saved words');
      expect(h.transport.send).toHaveBeenCalledTimes(1);
    } finally { h.storage.writeFailure = false; h.browser.dispose(); }
  });

  it('repairs failed typing persistence without submitting words that were never saved', async () => {
    const h = await fixture();
    try {
      h.storage.writeFailure = true;
      await expect(h.editor.edit({ ...h.editor.getState().checkpoint.draft, content: 'Unsent words' })).rejects.toThrow('disk full');
      h.storage.writeFailure = false;
      await h.engine.retry(resource);
      expect(await h.commits.list('owner')).toEqual([]);
      expect(h.editor.getState()).toMatchObject({ durable: true, error: null, checkpoint: { draft: { content: 'Unsent words' }, dirty: true } });
    } finally { h.storage.writeFailure = false; h.browser.dispose(); }
  });

  it.each(['document', 'manual'] as const)('retries the original %s Save while keeping later words unsent', async kind => {
    const h = await fixture(), form = kind === 'manual' ? h.editor.form('content', [['content']]) : null;
    try {
      if (form) { await form.begin(); await form.update(value => ({ ...value, content: 'Saved portion' })); }
      else await h.editor.edit({ ...h.editor.getState().checkpoint.draft, content: 'Saved portion' });
      h.storage.writeFailure = true;
      await expect(form ? form.save() : h.editor.save()).rejects.toThrow('disk full');
      h.storage.writeFailure = false;
      if (form) await form.update(value => ({ ...value, content: 'Later unsent words' }));
      else await h.editor.edit({ ...h.editor.getState().checkpoint.draft, content: 'Later unsent words' });
      const parent = describeSync(h.editor.getState(), h.editor.getObservation(), h.editor.getDelivery());
      const status = form ? describeManualSync(form.getState(), h.editor.getState(), parent, null) : parent;
      expect(status?.phase).toBe('localFailure');
      if (form) await form.retry(); else await h.engine.retry(resource);
      const requests = await h.commits.list('owner');
      expect(requests).toHaveLength(1); expect(requests[0].value?.content).toBe('Saved portion');
      h.engine.setOnline(true); await h.engine.retry(); await settleEngine();
      expect(h.server.value?.content).toBe('Saved portion');
      expect(form?.getState()?.value.content ?? h.editor.getState().checkpoint.draft?.content).toBe('Later unsent words');
    } finally { h.storage.writeFailure = false; h.browser.dispose(); }
  });

  it('does not revive a failed manual Save after the person cancels the form', async () => {
    const h = await fixture(), form = h.editor.form('content', [['content']]);
    try {
      await form.begin(); await form.update(value => ({ ...value, content: 'Cancelled words' }));
      h.storage.writeFailure = true; await expect(form.save()).rejects.toThrow('disk full'); h.storage.writeFailure = false;
      await form.cancel(); await form.retry(); h.engine.setOnline(true); await h.engine.retry(); await settleEngine();
      expect(h.server.value?.content).toBe('Original words'); expect(h.transport.send).not.toHaveBeenCalled();
    } finally { h.storage.writeFailure = false; h.browser.dispose(); }
  });


  it('captures two overlapping Saves of the same draft as one canonical request', async () => {
    const h = await fixture();
    try {
      await h.editor.edit({ ...h.editor.getState().checkpoint.draft, content: 'Same saved words' });
      h.storage.writeFailure = true;
      const first = h.editor.save(), second = h.editor.save();
      await Promise.all([expect(first).rejects.toThrow('disk full'), expect(second).rejects.toThrow('disk full')]);
      h.storage.writeFailure = false; await h.engine.retry(resource);
      expect(await h.commits.list('owner')).toHaveLength(1);
      h.engine.setOnline(true); await h.engine.retry(); await settleEngine();
      expect(h.server.value?.content).toBe('Same saved words'); expect(h.transport.send).toHaveBeenCalledTimes(1);
    } finally { h.storage.writeFailure = false; h.browser.dispose(); }
  });

  it.each(['document', 'manual'] as const)('keeps the canonical request identity when the %s projection fails after capture', async kind => {
    const h = await fixture(), form = kind === 'manual' ? h.editor.form('content', [['content']]) : null;
    try {
      if (form) { await form.begin(); await form.update(value => ({ ...value, content: 'Captured words' })); }
      else await h.editor.edit({ ...h.editor.getState().checkpoint.draft, content: 'Captured words' });
      if (form) {
        const create = h.commits.create;
        jest.spyOn(h.commits, 'create').mockImplementationOnce(async request => {
          const saved = await create(request);
          h.storage.writeFailure = true;
          return saved;
        });
      } else jest.spyOn(h.checkpoints, 'put').mockRejectedValueOnce(new Error('projection failed'));
      await expect(form ? form.save() : h.editor.save()).rejects.toThrow(form ? 'disk full' : 'projection failed');
      h.storage.writeFailure = false;
      const before = await h.commits.list('owner'); expect(before).toHaveLength(1);
      if (form) await form.retry(); else await h.engine.retry(resource);
      expect((await h.commits.list('owner')).map(request => request.id)).toEqual([before[0].id]);
      h.engine.setOnline(true); await h.engine.retry(); await settleEngine();
      expect(h.server.value?.content).toBe('Captured words'); expect(h.transport.send).toHaveBeenCalledTimes(1);
    } finally { h.storage.writeFailure = false; h.browser.dispose(); }
  });

  it('does not revive an old owner\'s failed form capture after an account change', async () => {
    const h = await fixture(), form = h.editor.form('content', [['content']]);
    try {
      await form.begin(); await form.update(value => ({ ...value, content: 'Old owner words' }));
      h.storage.writeFailure = true; await expect(form.save()).rejects.toThrow('disk full'); h.storage.writeFailure = false;
      h.engine.setOwner('another-owner');
      await expect(Promise.resolve().then(() => form.retry())).rejects.toThrow('Account changed');
      h.engine.setOnline(true); await h.engine.retry(); await settleEngine();
      expect(await h.commits.list('owner')).toEqual([]); expect(h.transport.send).not.toHaveBeenCalled();
    } finally { h.storage.writeFailure = false; h.browser.dispose(); }
  });

  it('keeps later explicit Saves after the earlier failed Save in user action order', async () => {
    const h = await fixture();
    try {
      await h.editor.edit({ ...h.editor.getState().checkpoint.draft, content: 'First saved portion' });
      h.storage.writeFailure = true; await expect(h.editor.save()).rejects.toThrow('disk full');
      h.storage.writeFailure = false;
      await h.editor.edit({ ...h.editor.getState().checkpoint.draft, content: 'Second saved portion' });
      await h.editor.save();
      const requests = await h.commits.list('owner');
      expect(requests).toHaveLength(2);
      const first = requests.find(request => request.value?.content === 'First saved portion')!;
      const second = requests.find(request => request.value?.content === 'Second saved portion')!;
      expect(first).toBeDefined(); expect(second).toBeDefined(); expect(second.predecessor).toBe(first.id);
      h.engine.setOnline(true); await h.engine.retry(); await settleEngine();
      expect(h.server.value?.content).toBe('Second saved portion'); expect(h.transport.send).toHaveBeenCalledTimes(2);
    } finally { h.storage.writeFailure = false; h.browser.dispose(); }
  });

  it('does not revive a failed document Save after an explicit choice of the saved version', async () => {
    const h = await fixture();
    try {
      await h.editor.edit({ ...h.editor.getState().checkpoint.draft, content: 'Abandoned words' });
      h.storage.writeFailure = true; await expect(h.editor.save()).rejects.toThrow('disk full');
      h.storage.writeFailure = false;
      h.silentRemote({ content: 'Chosen saved words' }); h.engine.setOnline(true);
      await jest.advanceTimersByTimeAsync(0); await settleEngine();
      expect(h.editor.getState().checkpoint.remoteCandidate?.value?.content).toBe('Chosen saved words');
      const sendsBeforeChoice = (h.transport.send as jest.Mock).mock.calls.length;
      expect(sendsBeforeChoice).toBe(1); // Reconnection already retried the Save and received a conflict.
      await h.editor.acceptRemote(); await h.engine.retry(resource); await settleEngine();
      expect(h.editor.getState().checkpoint.draft?.content).toBe('Chosen saved words');
      expect(h.server.value?.content).toBe('Chosen saved words'); expect(h.transport.send).toHaveBeenCalledTimes(sendsBeforeChoice);
    } finally { h.storage.writeFailure = false; h.browser.dispose(); }
  });

  it('keeps repeated failed retries visible and captures after storage is repaired', async () => {
    const h = await fixture();
    try {
      await h.editor.edit({ ...h.editor.getState().checkpoint.draft, content: 'Waiting words' });
      h.storage.writeFailure = true; await expect(h.editor.save()).rejects.toThrow('disk full');
      await expect(h.engine.retry(resource)).rejects.toThrow('disk full');
      expect(describeSync(h.editor.getState(), h.editor.getObservation(), h.editor.getDelivery()).phase).toBe('localFailure');
      h.storage.writeFailure = false; await h.engine.retry(resource);
      expect((await h.commits.list('owner'))[0].value?.content).toBe('Waiting words');
    } finally { h.storage.writeFailure = false; h.browser.dispose(); }
  });

});
