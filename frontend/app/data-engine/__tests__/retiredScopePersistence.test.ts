import { membershipEngineHarness } from '@test-utils/membershipEngineHarness';
import { settleEngine } from '@test-utils/documentEngineHarness';

import * as checkpoints from '../checkpoint.client';
import * as manualScopes from '../manualScopes.client';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('../checkpoint.client', () => {
  const actual = jest.requireActual('../checkpoint.client');
  return { ...actual, createIndexedDbCheckpoints: jest.fn(actual.createIndexedDbCheckpoints) };
});
jest.mock('../manualScopes.client', () => {
  const actual = jest.requireActual('../manualScopes.client');
  return { ...actual, createIndexedDbManualScopes: jest.fn(actual.createIndexedDbManualScopes) };
});
afterEach(() => jest.restoreAllMocks());

const resource = { collection: 'studyNotes', id: 'retired-note' };
const value = { userId: 'owner', title: 'Opening title', content: 'Retained note', tags: [], scriptureRefs: [],
  isDraft: false, createdAt: '2026-10-26', updatedAt: '2026-10-26' };
function setup() {
  const h = membershipEngineHarness([{ resource, value, metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false } }]);
  const checkpointStore = jest.requireActual<typeof checkpoints>('../checkpoint.client').createIndexedDbCheckpoints();
  const manualStore = jest.requireActual<typeof manualScopes>('../manualScopes.client').createIndexedDbManualScopes();
  jest.mocked(checkpoints.createIndexedDbCheckpoints).mockReturnValueOnce(checkpointStore);
  jest.mocked(manualScopes.createIndexedDbManualScopes).mockReturnValueOnce(manualStore);
  const browser = h.createBrowser(), engine = browser.engine;
  engine.setOnline(false); engine.setOwner('owner');
  return { h, browser, engine, checkpointStore, manualStore };
}

describe('last words handed over by retired stages', () => {
  it('keeps manual typing for its original owner when the account changes before the write runs', async () => {
    const t = setup();
    try {
      const editor = await t.engine.openEditor(resource, t.browser.editorId(resource));
      const form = editor.form('title', [['title']]); await form.begin();
      void form.update(current => ({ ...current, title: 'Latest manual words' })).catch(() => undefined);
      t.engine.setOwner('another-owner'); await settleEngine();
      expect(await t.manualStore.list('another-owner')).toEqual([]);
      expect((await t.manualStore.list('owner'))[0]?.record.stage[0]).toEqual({ exists: true, value: 'Latest manual words' });
      expect(t.h.transport.send).not.toHaveBeenCalled();
    } finally { t.browser.dispose(); }
  });

  it('keeps creation typing for its original owner when the account changes before the write runs', async () => {
    const t = setup();
    try {
      const scope = await t.engine.beginMemberCreation('sermons', { title: 'First creation words', verse: '', date: 'now', thoughts: [] });
      const initial = scope.getState().record;
      void scope.updateCreation({ ...initial.creation!.value, title: 'Latest creation words' }).catch(() => undefined);
      t.engine.setOwner('another-owner'); await settleEngine();
      expect(await t.h.scopes.list('another-owner')).toEqual([]);
      expect((await t.h.scopes.read('owner', initial.scopeId))?.creation?.value.title).toBe('Latest creation words');
      expect(t.h.transport.send).not.toHaveBeenCalled();
    } finally { t.browser.dispose(); }
  });

  it('retries the last checkpoint of a closed editor after device storage recovers', async () => {
    const t = setup();
    try {
      const id = t.browser.editorId(resource), editor = await t.engine.openEditor(resource, id);
      jest.spyOn(t.checkpointStore, 'put').mockRejectedValueOnce(new Error('Device storage refused the handoff'));
      void editor.edit({ ...value, content: 'Last words before leaving' }).catch(() => undefined);
      editor.close({ flush: false }); await settleEngine();
      await t.engine.retry(); await settleEngine();
      expect((await t.checkpointStore.read('owner', id))?.checkpoint.draft?.content).toBe('Last words before leaving');
      expect(t.h.transport.send).not.toHaveBeenCalled();
    } finally { t.browser.dispose(); }
  });

  it('preserves an already captured manual stage through an account change', async () => {
    const t = setup();
    try {
      const editor = await t.engine.openEditor(resource, t.browser.editorId(resource));
      const form = editor.form('title', [['title']]); await form.begin();
      await form.update(current => ({ ...current, title: 'Already captured manual words' }));
      t.engine.setOwner('another-owner'); await settleEngine();
      expect((await t.manualStore.list('owner'))[0]?.record.stage[0]).toEqual({ exists: true, value: 'Already captured manual words' });
      expect(await t.manualStore.list('another-owner')).toEqual([]);
    } finally { t.browser.dispose(); }
  });

  it('preserves an already captured creation stage through an account change', async () => {
    const t = setup();
    try {
      const scope = await t.engine.beginMemberCreation('sermons', { title: 'First words', verse: '', date: 'now', thoughts: [] });
      const initial = scope.getState().record;
      await scope.updateCreation({ ...initial.creation!.value, title: 'Already captured creation words' });
      t.engine.setOwner('another-owner'); await settleEngine();
      expect((await t.h.scopes.read('owner', initial.scopeId))?.creation?.value.title).toBe('Already captured creation words');
      expect(await t.h.scopes.list('another-owner')).toEqual([]);
    } finally { t.browser.dispose(); }
  });

  it('does not revive a manual stage explicitly cancelled before the account changes', async () => {
    const t = setup();
    try {
      const editor = await t.engine.openEditor(resource, t.browser.editorId(resource));
      const form = editor.form('title', [['title']]); await form.begin();
      await form.update(current => ({ ...current, title: 'Explicitly discarded words' })); await form.cancel();
      t.engine.setOwner('another-owner'); await settleEngine();
      expect(await t.manualStore.list('owner')).toEqual([]);
      expect(await t.manualStore.list('another-owner')).toEqual([]);
      expect(t.h.transport.send).not.toHaveBeenCalled();
    } finally { t.browser.dispose(); }
  });

  it('does not let an old failed handoff overwrite later typing in the same editor identity', async () => {
    const t = setup();
    try {
      const id = t.browser.editorId(resource), first = await t.engine.openEditor(resource, id);
      jest.spyOn(t.checkpointStore, 'put').mockRejectedValueOnce(new Error('Device storage refused the handoff'));
      void first.edit({ ...value, content: 'Earlier words' }).catch(() => undefined);
      first.close({ flush: false }); await settleEngine();
      const next = await t.engine.openEditor(resource, id);
      await next.edit({ ...value, content: 'Later words' }); await settleEngine();
      await t.engine.retry(); await settleEngine();
      expect((await t.checkpointStore.read('owner', id))?.checkpoint.draft?.content).toBe('Later words');
    } finally { t.browser.dispose(); }
  });
});


describe('retired forms after a storage refusal', () => {
  it('retries the last manual stage after its parent screen has closed', async () => {
    const t = setup();
    try {
      const editor = await t.engine.openEditor(resource, t.browser.editorId(resource));
      const form = editor.form('title', [['title']]); await form.begin();
      jest.spyOn(t.manualStore, 'put').mockRejectedValueOnce(new Error('Device storage refused the manual stage'));
      const editing = form.update(current => ({ ...current, title: 'Manual words before leaving' }));
      void editing.catch(() => undefined); editor.close({ flush: false });
      await editing.catch(() => undefined); await settleEngine(); await t.engine.retry(); await settleEngine();
      expect((await t.manualStore.list('owner'))[0]?.record.stage[0]).toEqual({ exists: true, value: 'Manual words before leaving' });
      expect(t.h.transport.send).not.toHaveBeenCalled();
    } finally { t.browser.dispose(); }
  });

  it('retries the last creation stage after releasing a selector whose device write failed', async () => {
    const t = setup();
    try {
      const scope = await t.engine.beginMemberCreation('sermons', { title: 'First words', verse: '', date: 'now', thoughts: [] });
      const initial = scope.getState().record;
      jest.spyOn(t.h.scopes, 'persist').mockRejectedValueOnce(new Error('Device storage refused the creation stage'));
      const editing = scope.updateCreation({ ...initial.creation!.value, title: 'Creation words before leaving' });
      void editing.catch(() => undefined); t.engine.releaseMembership(initial.scopeId);
      await editing.catch(() => undefined); await settleEngine(); await t.engine.retry(); await settleEngine();
      expect((await t.h.scopes.read('owner', initial.scopeId))?.creation?.value.title).toBe('Creation words before leaving');
      expect(t.h.transport.send).not.toHaveBeenCalled();
    } finally { t.browser.dispose(); }
  });

  it('still captures a healthy manual stage when its parent closes during persistence', async () => {
    const t = setup();
    try {
      const editor = await t.engine.openEditor(resource, t.browser.editorId(resource));
      const form = editor.form('title', [['title']]); await form.begin();
      const editing = form.update(current => ({ ...current, title: 'Healthy manual words' }));
      void editing.catch(() => undefined); editor.close({ flush: false });
      await editing.catch(() => undefined); await settleEngine();
      expect((await t.manualStore.list('owner'))[0]?.record.stage[0]).toEqual({ exists: true, value: 'Healthy manual words' });
      expect(t.h.transport.send).not.toHaveBeenCalled();
    } finally { t.browser.dispose(); }
  });

  it('still captures a healthy creation stage when its selector releases during persistence', async () => {
    const t = setup();
    try {
      const scope = await t.engine.beginMemberCreation('sermons', { title: 'First words', verse: '', date: 'now', thoughts: [] });
      const initial = scope.getState().record;
      const editing = scope.updateCreation({ ...initial.creation!.value, title: 'Healthy creation words' });
      void editing.catch(() => undefined); t.engine.releaseMembership(initial.scopeId);
      await editing.catch(() => undefined); await settleEngine();
      expect((await t.h.scopes.read('owner', initial.scopeId))?.creation?.value.title).toBe('Healthy creation words');
      expect(t.h.transport.send).not.toHaveBeenCalled();
    } finally { t.browser.dispose(); }
  });
});


it('honors manual Cancel already requested when the account changes before its write', async () => {
  const t = setup();
  try {
    const editor = await t.engine.openEditor(resource, t.browser.editorId(resource));
    const form = editor.form('title', [['title']]); await form.begin();
    await form.update(current => ({ ...current, title: 'Discarded by the person' }));
    const cancelling = form.cancel(); void cancelling.catch(() => undefined);
    t.engine.setOwner('another-owner'); await cancelling.catch(() => undefined); await settleEngine();
    expect(await t.manualStore.list('owner')).toEqual([]);
    expect(t.h.transport.send).not.toHaveBeenCalled();
  } finally { t.browser.dispose(); }
});

it('honors creation Cancel already requested when the account changes before its write', async () => {
  const t = setup();
  try {
    const scope = await t.engine.beginMemberCreation('sermons', { title: 'Discarded creation', verse: '', date: 'now', thoughts: [] });
    const id = scope.getState().record.scopeId;
    const cancelling = scope.cancel(); void cancelling.catch(() => undefined);
    t.engine.setOwner('another-owner'); await cancelling.catch(() => undefined); await settleEngine();
    expect((await t.h.scopes.read('owner', id))?.phase).toBe('cancelled');
    expect(t.h.transport.send).not.toHaveBeenCalled();
  } finally { t.browser.dispose(); }
});
