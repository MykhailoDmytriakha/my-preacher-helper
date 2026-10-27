import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';
import { createIndexedDbManualScopes, type StoredManualScope } from '../manualScopes.client';
import type { DocumentData } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const resource = { collection: 'sermons', id: 'prep-lineage' };
const initial = { userId: 'owner', title: 'Preparation QA', verse: 'John 3:16', date: 'now', thoughts: [],
  preparation: { mainIdea: { contextIdea: 'Opening words' } } };
const words = (current: DocumentData, text: string): DocumentData => {
  const preparation = (current.preparation ?? {}) as DocumentData;
  return { ...current, preparation: { ...preparation, mainIdea: { ...preparation.mainIdea as DocumentData, contextIdea: text } } };
};

it.each(['local', 'remote'] as const)('can save a still-open field after a pending capture and header %s choice', async choice => {
  const h = documentEngineHarness({ resource, value: initial, metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false } });
  const browser = h.createBrowser(), engine = browser.engine; engine.setOnline(false); engine.setOwner('owner');
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  try {
    const editor = await engine.openEditor(resource, browser.editorId(resource));
    const form = editor.form('prep-mainIdea-contextIdea', [['preparation', 'mainIdea', 'contextIdea']]); await form.begin();
    await form.update(current => words(current, 'First saved words'));
    const create = h.commits.create.bind(h.commits);
    jest.spyOn(h.commits, 'create').mockImplementationOnce(async record => { entered(); await held; return create(record); });
    const first = form.save(); void first.catch(() => undefined); await started;
    const later = form.update(current => words(current, 'First plus later words')); void later.catch(() => undefined);
    h.silentRemote({ preparation: { mainIdea: { contextIdea: 'Phone words' } } });
    release(); await first; await later;
    engine.setOnline(true); await engine.retry(); await settleEngine();
    expect(editor.getState().result?.kind).toBe('conflict');
    if (choice === 'local') { await editor.keepLocal(); await editor.save(); }
    else await editor.acceptRemote();
    await engine.retry(); await settleEngine();
    expect(form.getState()?.value.preparation).toEqual({ mainIdea: { contextIdea: 'First plus later words' } });
    if (choice === 'remote') {
      // The explicit choice retired the old saved intent, not the later unsent words.
      expect(form.getState()).toMatchObject({ dirty: true, choiceRequired: true });
      await expect(form.save()).rejects.toMatchObject({ code: 'resolve-version-first' });
      expect(h.server.value?.preparation).toEqual({ mainIdea: { contextIdea: 'Phone words' } });
      await form.resolve('local');
    } else await expect(form.save()).resolves.toBeUndefined();
    await engine.retry(); await settleEngine();
    expect(h.server.value?.preparation).toEqual({ mainIdea: { contextIdea: 'First plus later words' } });
  } finally { release?.(); browser.dispose(); await settleEngine(); jest.restoreAllMocks(); }
});


it.each(['local', 'remote', 'cancel'] as const)('retains returned opening words until explicit field %s choice', async choice => {
  const h = documentEngineHarness({ resource, value: initial, metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false } });
  const browser = h.createBrowser(), engine = browser.engine;
  engine.setOnline(false); engine.setOwner('owner');
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    const editor = await engine.openEditor(resource, browser.editorId(resource));
    const form = editor.form('prep-mainIdea-contextIdea', [['preparation', 'mainIdea', 'contextIdea']]);
    await form.begin();
    await form.update(current => words(current, 'First saved words'));
    const create = h.commits.create.bind(h.commits);
    jest.spyOn(h.commits, 'create').mockImplementationOnce(async record => { entered(); await held; return create(record); });
    const first = form.save(); void first.catch(() => undefined); await started;
    const later = form.update(current => words(current, 'Opening words')); void later.catch(() => undefined);
    h.silentRemote({ preparation: { mainIdea: { contextIdea: 'Phone words' } } });
    release(); await first; await later;
    engine.setOnline(true); await engine.retry(); await settleEngine();
    expect(editor.getState().result?.kind).toBe('conflict');
    await editor.acceptRemote(); await engine.retry(); await settleEngine();
    expect(form.getState()?.value.preparation).toEqual({ mainIdea: { contextIdea: 'Opening words' } });
    // Returning to an earlier sentence still changes the saved First sentence.
    expect(form.getState()?.dirty).toBe(true);
    expect(h.server.value?.preparation).toEqual({ mainIdea: { contextIdea: 'Phone words' } });
    expect(form.getState()).toMatchObject({ choiceRequired: true });
    await expect(form.save()).rejects.toMatchObject({ code: 'resolve-version-first' });
    if (choice === 'cancel') { await form.cancel(); await form.begin(); }
    else await form.resolve(choice);
    await engine.retry(); await settleEngine();
    expect(h.server.value?.preparation).toEqual({ mainIdea: { contextIdea: choice === 'local' ? 'Opening words' : 'Phone words' } });
    expect(form.getState()?.dirty).toBe(false);
  } finally { release?.(); browser.dispose(); await settleEngine(); jest.restoreAllMocks(); }
});


async function pendingFieldStage(laterWords = 'Opening words') {
  const h = documentEngineHarness({ resource, value: initial, metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false } });
  const browser = h.createBrowser(), engine = browser.engine;
  engine.setOnline(false); engine.setOwner('owner');
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    const editor = await engine.openEditor(resource, browser.editorId(resource));
    const form = editor.form('prep-mainIdea-contextIdea', [['preparation', 'mainIdea', 'contextIdea']]);
    await form.begin(); await form.update(current => words(current, 'First saved words'));
    const create = h.commits.create.bind(h.commits);
    const delayed = jest.spyOn(h.commits, 'create').mockImplementationOnce(async record => { entered(); await held; return create(record); });
    const first = form.save(); void first.catch(() => undefined); await started;
    const later = form.update(current => words(current, laterWords)); void later.catch(() => undefined);
    h.silentRemote({ preparation: { mainIdea: { contextIdea: 'Phone words' } } });
    release(); await first; await later; delayed.mockRestore();
    engine.setOnline(true); await engine.retry(); await settleEngine();
    expect(editor.getState().result?.kind).toBe('conflict');
    return { h, browser, engine, editor, form };
  } catch (error) { release?.(); browser.dispose(); throw error; }
}

it.each(['parent close', 'browser replacement'] as const)('recovers the exact unsent ancestry after %s', async boundary => {
  const s = await pendingFieldStage(); let browser = s.browser;
  try {
    await s.editor.acceptRemote(); await settleEngine();
    const scopeId = s.form.getState()!.record.scopeId;
    if (boundary === 'parent close') s.editor.dispose();
    else { s.browser.dispose(); browser = s.h.createBrowser(); browser.engine.setOwner('owner'); }
    await settleEngine();
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    const form = editor.form('prep-mainIdea-contextIdea', [['preparation', 'mainIdea', 'contextIdea']]);
    await form.begin();
    expect(await form.listRecoverable()).toEqual(expect.arrayContaining([expect.objectContaining({ scopeId })]));
    await form.recover(scopeId);
    expect(form.getState()).toMatchObject({ dirty: true, durable: true, choiceRequired: true,
      value: { preparation: { mainIdea: { contextIdea: 'Opening words' } } },
      record: { baseline: { metadata: { revision: 1 } }, predecessor: { value: { preparation: { mainIdea: { contextIdea: 'First saved words' } } } } } });
    expect(s.h.server.value?.preparation).toEqual({ mainIdea: { contextIdea: 'Phone words' } });
    await form.resolve('local'); await browser.engine.retry(); await settleEngine();
    expect(s.h.server.value?.preparation).toEqual({ mainIdea: { contextIdea: 'Opening words' } });
  } finally { browser.dispose(); s.browser.dispose(); await settleEngine(); jest.restoreAllMocks(); }
});

it('taking stored field words does not cancel a newer pending parent request', async () => {
  const s = await pendingFieldStage();
  try {
    await s.editor.acceptRemote(); s.engine.setOnline(false);
    await s.editor.commit(value => ({ ...value, title: 'Newer parent title' })); await settleEngine();
    const pending = (await s.h.commits.list('owner')).filter(request => request.state !== 'cancelled');
    expect(pending).toHaveLength(1);
    await s.form.resolve('remote');
    expect((await s.h.commits.list('owner')).find(request => request.id === pending[0].id)?.state).not.toBe('cancelled');
    s.engine.setOnline(true); await s.engine.retry(); await settleEngine();
    expect(s.h.server.value).toMatchObject({ title: 'Newer parent title', preparation: { mainIdea: { contextIdea: 'Phone words' } } });
  } finally { s.browser.dispose(); await settleEngine(); jest.restoreAllMocks(); }
});

it('keeps stage ancestry and usable explicit retry when the parent replacement capture fails', async () => {
  const s = await pendingFieldStage();
  try {
    jest.spyOn(s.h.commits, 'createWithCheckpoint').mockRejectedValueOnce(new Error('Replacement disk full'));
    await expect(s.editor.keepLocal()).rejects.toThrow('Replacement disk full');
    expect(s.form.getState()).toMatchObject({ dirty: true, durable: true, choiceRequired: true,
      value: { preparation: { mainIdea: { contextIdea: 'Opening words' } } } });
    await s.form.resolve('local'); await s.engine.retry(); await settleEngine();
    expect(s.h.server.value?.preparation).toEqual({ mainIdea: { contextIdea: 'Opening words' } });
  } finally { s.browser.dispose(); await settleEngine(); jest.restoreAllMocks(); }
});


it('delivers the explicit parent local replacement without a later retry or another save', async () => {
  const s = await pendingFieldStage('First plus later words');
  try {
    await s.editor.keepLocal(); await settleEngine();
    expect(s.h.server.value?.preparation).toEqual({ mainIdea: { contextIdea: 'First saved words' } });
    expect(s.form.getState()).toMatchObject({ dirty: true, value: { preparation: { mainIdea: { contextIdea: 'First plus later words' } } } });
  } finally { s.browser.dispose(); await settleEngine(); jest.restoreAllMocks(); }
});


it('retains stage words when a newer parent send has an unknown outcome', async () => {
  const s = await pendingFieldStage();
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    await s.editor.acceptRemote();
    const send = s.h.transport.send.bind(s.h.transport);
    jest.spyOn(s.h.transport, 'send').mockImplementationOnce(async command => { entered(); await held; return send(command); });
    await s.editor.commit(value => words(value!, 'Newer pending words')); await started;
    await expect(s.form.resolve('local')).rejects.toMatchObject({ code: 'pending-delivery-first' });
    expect(s.form.getState()).toMatchObject({ dirty: true, choiceRequired: true,
      value: { preparation: { mainIdea: { contextIdea: 'Opening words' } } } });
    release(); await s.engine.retry(); await settleEngine();
    expect(s.h.server.value?.preparation).toEqual({ mainIdea: { contextIdea: 'Newer pending words' } });
    await s.form.resolve('local'); await s.engine.retry(); await settleEngine();
    expect(s.h.server.value?.preparation).toEqual({ mainIdea: { contextIdea: 'Opening words' } });
  } finally { release?.(); s.browser.dispose(); await settleEngine(); jest.restoreAllMocks(); }
});


it.each([
  ['local', 'parent close'], ['remote', 'parent close'],
  ['local', 'owner change'], ['remote', 'owner change'],
] as const)('retains stage ancestry when %s choice is interrupted by %s', async (choice, boundary) => {
  const s = await pendingFieldStage();
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    const scopeId = s.form.getState()!.record.scopeId;
    const put = s.h.checkpoints.put.bind(s.h.checkpoints);
    jest.spyOn(s.h.checkpoints, 'put').mockImplementationOnce(async record => { entered(); await held; return put(record); });
    const choosing = choice === 'local' ? s.editor.keepLocal() : s.editor.acceptRemote();
    void choosing.catch(() => undefined); await started;
    if (boundary === 'parent close') s.editor.dispose(); else s.engine.setOwner('another-owner');
    release(); await expect(choosing).rejects.toThrow(); await settleEngine();
    if (boundary === 'owner change') s.engine.setOwner('owner');
    const editor = await s.engine.openEditor(resource, s.browser.editorId(resource));
    const form = editor.form('prep-mainIdea-contextIdea', [['preparation', 'mainIdea', 'contextIdea']]);
    await form.begin(); await form.recover(scopeId);
    const recovered = form.getState()!;
    if (!recovered.dirty) throw new Error('Recovered unsent ancestry became clean: ' + JSON.stringify({ record: recovered.record, editor: editor.getState().checkpoint, server: s.h.server }));
    expect({ dirty: recovered.dirty, durable: recovered.durable, stage: recovered.record.stage, saved: recovered.record.savedSelection,
      baseline: recovered.record.baseline.metadata, predecessor: recovered.record.predecessor, editor: editor.getState().checkpoint, server: s.h.server }).toMatchObject({ dirty: true, durable: true });
    expect(recovered.value.preparation).toEqual({ mainIdea: { contextIdea: 'Opening words' } });
    if (form.getState()?.choiceRequired) await form.resolve('local'); else await form.save();
    await s.engine.retry(); await settleEngine();
    expect(s.h.server.value?.preparation).toEqual({ mainIdea: { contextIdea: 'Opening words' } });
  } finally { release?.(); s.browser.dispose(); await settleEngine(); jest.restoreAllMocks(); }
});


it('does not start a fresh field on a request retired while its capture waited', async () => {
  const s = await pendingFieldStage('Later unsent words');
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    const list = s.h.commits.list.bind(s.h.commits), before = await list('owner');
    jest.spyOn(s.h.commits, 'list').mockImplementationOnce(async () => { entered(); await held; return before; });
    const fresh = s.editor.form('fresh-field', [['preparation', 'mainIdea', 'contextIdea']]);
    const opening = fresh.begin(); void opening.catch(() => undefined); await started;
    await s.editor.acceptRemote(); release();
    await expect(opening).rejects.toThrow('An unsaved editor already owns a selected field');
    await fresh.begin();
    expect(fresh.getState()).toMatchObject({ dirty: false, record: { predecessor: null },
      value: { preparation: { mainIdea: { contextIdea: 'Phone words' } } } });
    expect(s.form.getState()).toMatchObject({ dirty: true, choiceRequired: true,
      value: { preparation: { mainIdea: { contextIdea: 'Later unsent words' } } } });
  } finally { release?.(); s.browser.dispose(); await settleEngine(); jest.restoreAllMocks(); }
});


it.each(['unchanged', 'later typing', 'Cancel'] as const)('chains a recovered durable capture across owner change after %s', async boundary => {
  const h = documentEngineHarness({ resource, value: initial, metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false } });
  const browser = h.createBrowser(), engine = browser.engine;
  engine.setOnline(false); engine.setOwner('owner');
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    const editor = await engine.openEditor(resource, browser.editorId(resource));
    const form = editor.form('prep-mainIdea-contextIdea', [['preparation', 'mainIdea', 'contextIdea']]);
    await form.begin(); await form.update(current => words(current, 'Durable first Save'));
    const scopeId = form.getState()!.record.scopeId;
    const create = h.commits.create.bind(h.commits);
    jest.spyOn(h.commits, 'create').mockImplementationOnce(async record => {
      const saved = await create(record); entered(); await held; return saved;
    });
    const first = form.save(); void first.catch(() => undefined); await started;
    const subsequent = boundary === 'later typing' ? form.update(current => words(current, 'Later unsent words'))
      : boundary === 'Cancel' ? form.cancel() : Promise.resolve();
    void subsequent.catch(() => undefined);
    engine.setOwner('another-owner'); release(); await expect(first).rejects.toThrow(); await subsequent.catch(() => undefined); await settleEngine();
    engine.setOwner('owner');
    const reopened = await engine.openEditor(resource, browser.editorId(resource));
    const recovered = reopened.form('prep-mainIdea-contextIdea', [['preparation', 'mainIdea', 'contextIdea']]);
    await recovered.begin();
    if (boundary === 'Cancel') {
      const cancelled = (await recovered.listRecoverable()).find(choice => choice.scopeId === scopeId);
      if (cancelled) expect(cancelled.record).toMatchObject({ active: false, stage: [{ exists: true, value: 'Durable first Save' }], savedSelection: [{ exists: true, value: 'Durable first Save' }] });
    }
    else await recovered.recover(scopeId);
    expect(recovered.getState()?.value.preparation).toEqual({ mainIdea: { contextIdea: boundary === 'later typing' ? 'Later unsent words' : 'Durable first Save' } });
    await recovered.update(current => words(current, 'Later recovered Save'));
    await recovered.save();
    const requests = (await h.commits.list('owner')).filter(request => request.baseline.resource.id === resource.id);
    const old = requests.find(request => (request.value?.preparation as typeof initial.preparation)?.mainIdea.contextIdea === 'Durable first Save');
    const later = requests.find(request => (request.value?.preparation as typeof initial.preparation)?.mainIdea.contextIdea === 'Later recovered Save');
    expect(old).toBeDefined(); expect(later).toBeDefined();
    engine.setOnline(true); await engine.retry(); await settleEngine();
    expect(h.server.value?.preparation).toEqual({ mainIdea: { contextIdea: 'Later recovered Save' } });
    expect(later).toMatchObject({ predecessor: old!.id });
  } finally { release?.(); browser.dispose(); await settleEngine(); jest.restoreAllMocks(); }
});


it('finishes only an already invoked Save when owner retirement beats its queued device write', async () => {
  const h = documentEngineHarness({ resource, value: initial, metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false } });
  const browser = h.createBrowser(), engine = browser.engine; engine.setOnline(false); engine.setOwner('owner');
  try {
    const editor = await engine.openEditor(resource, browser.editorId(resource));
    const form = editor.form('prep-mainIdea-contextIdea', [['preparation', 'mainIdea', 'contextIdea']]); await form.begin();
    const saving = form.save(current => words(current, 'Invoked before owner change')); void saving.catch(() => undefined);
    engine.setOwner('another-owner'); await saving.catch(() => undefined); await settleEngine();
    expect((await h.commits.list('owner')).map(request => request.value?.preparation)).toContainEqual({ mainIdea: { contextIdea: 'Invoked before owner change' } });
    expect(await h.commits.list('another-owner')).toEqual([]); expect(h.transport.send).not.toHaveBeenCalled();
    expect(() => form.save(current => words(current, 'Not authorized after owner change'))).toThrow();
    engine.setOwner('owner'); engine.setOnline(true); await engine.retry(); await settleEngine();
    expect(h.server.value?.preparation).toEqual({ mainIdea: { contextIdea: 'Invoked before owner change' } });
  } finally { browser.dispose(); await settleEngine(); }
});


it.each([false, true])('reconciles a historical durable request whose manual receipt was lost, later words: %s', async laterWords => {
  const h = documentEngineHarness({ resource, value: initial, metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false } });
  let browser = h.createBrowser(); browser.engine.setOnline(false); browser.engine.setOwner('owner');
  const store = createIndexedDbManualScopes();
  try {
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    const form = editor.form('prep-mainIdea-contextIdea', [['preparation', 'mainIdea', 'contextIdea']]); await form.begin();
    await form.update(current => words(current, 'Historical captured words'));
    const scopeId = form.getState()!.record.scopeId, before = await store.read('owner', scopeId) as StoredManualScope;
    await form.save();
    if (laterWords) { await form.begin(); await form.update(current => words(current, 'Historical later unsent words')); }
    const after = await store.read('owner', scopeId) as StoredManualScope;
    browser.dispose(); await settleEngine();
    // Replay the actual original stage plus the missed receipt shape of the older implementation.
    await store.put({ ...before, record: { ...after.record, predecessor: before.record.predecessor,
      savedGeneration: before.record.savedGeneration, savedSelection: before.record.savedSelection }, commitReferences: before.commitReferences });
    browser = h.createBrowser(); browser.engine.setOnline(false); browser.engine.setOwner('owner');
    const reopened = await browser.engine.openEditor(resource, browser.editorId(resource));
    const recovered = reopened.form('prep-mainIdea-contextIdea', [['preparation', 'mainIdea', 'contextIdea']]);
    await recovered.begin(); await recovered.recover(scopeId);
    expect(recovered.getState()).toMatchObject({ dirty: laterWords, value: { preparation: {
      mainIdea: { contextIdea: laterWords ? 'Historical later unsent words' : 'Historical captured words' } } } });
    await recovered.update(current => words(current, 'New saved words after historical recovery')); await recovered.save();
    browser.engine.setOnline(true); await browser.engine.retry(); await settleEngine();
    expect(h.server.value?.preparation).toEqual({ mainIdea: { contextIdea: 'New saved words after historical recovery' } });
  } finally { browser.dispose(); await settleEngine(); }
});


it('does not discard a cancelled-ancestor field when a newer stored copy arrives during its retained observation', async () => {
  const s = await pendingFieldStage('Unsent words still mine');
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    await s.editor.acceptRemote(); await settleEngine();
    const comparison = s.form.getState()?.comparison;
    expect(comparison).toBeDefined();
    expect(s.form.getState()?.choiceRequired).toBe(true);
    const observed = s.engine as unknown as { observeManualChoice(...args: unknown[]): Promise<void> };
    const original = observed.observeManualChoice.bind(observed);
    jest.spyOn(observed, 'observeManualChoice').mockImplementationOnce(async (...args) => { entered(); await held; return original(...args); });
    const choosing = s.form.resolve('remote', { expectedComparison: comparison });
    void choosing.catch(() => undefined);
    await started;
    await s.h.remote({ preparation: { mainIdea: { contextIdea: 'Newer stored phone words' } } });
    release();
    await expect(choosing).rejects.toMatchObject({ code: 'decision-changed' });
    expect(s.form.getState()?.value.preparation).toEqual({ mainIdea: { contextIdea: 'Unsent words still mine' } });
    expect(s.form.getState()?.dirty).toBe(true);
    expect(s.h.server.value?.preparation).toEqual({ mainIdea: { contextIdea: 'Newer stored phone words' } });
  } finally { release?.(); jest.restoreAllMocks(); s.browser.dispose(); await settleEngine(); }
});
