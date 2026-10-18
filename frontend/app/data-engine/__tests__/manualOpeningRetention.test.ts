import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import * as manualStores from '../manualScopes.client';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('../manualScopes.client', () => {
  const actual = jest.requireActual('../manualScopes.client');
  return { ...actual, createIndexedDbManualScopes: jest.fn(actual.createIndexedDbManualScopes) };
});
afterEach(() => jest.restoreAllMocks());

const resource = { collection: 'studyNotes', id: 'note' };
const snapshot = { resource, value: { userId: 'owner', title: 'Opening title', content: 'Kept words', tags: [], scriptureRefs: [], isDraft: false,
  createdAt: '2026-10-18', updatedAt: '2026-10-18' }, metadata: { protocol: 1 as const, generation: 'g1', revision: 1, deleted: false } };
const setup = () => {
  const h = documentEngineHarness(snapshot);
  const actual = jest.requireActual<typeof manualStores>('../manualScopes.client');
  const store = actual.createIndexedDbManualScopes();
  jest.mocked(manualStores.createIndexedDbManualScopes).mockReturnValueOnce(store);
  const browser = h.createBrowser({ withCollections: true });
  browser.engine.setOnline(false); browser.engine.setOwner('owner');
  return { h, store, browser, engine: browser.engine };
};
type Fixture = ReturnType<typeof setup>;
type Boundary = 'request list' | 'scope read' | 'scope create';
const hold = async (s: Fixture, boundary: Boundary) => {
  let release!: () => void, entered = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const list = s.h.commits.list.bind(s.h.commits), earlier = await list('owner');
  if (boundary === 'request list') jest.spyOn(s.h.commits, 'list').mockImplementationOnce(async () => { entered = true; await gate; return earlier; });
  else if (boundary === 'scope read') {
    const read = s.store.read.bind(s.store);
    jest.spyOn(s.store, 'read').mockImplementationOnce(async (...args) => { const value = await read(...args); entered = true; await gate; return value; });
  } else {
    const create = s.store.create.bind(s.store);
    jest.spyOn(s.store, 'create').mockImplementationOnce(async value => { entered = true; await gate; await create(value); });
  }
  return { release, list, earlier, get entered() { return entered; } };
};
const accept = async (s: Fixture) => { s.engine.setOnline(true); await s.engine.retry(); await settleEngine(); };

it.each(['request list', 'scope read', 'scope create'] as const)('opens selected accepted words when delivery finishes during %s', async boundary => {
  const s = setup(); let gate: Awaited<ReturnType<typeof hold>> | undefined, opening: Promise<void> | undefined;
  try {
    const editor = await s.engine.openEditor(resource, s.browser.editorId(resource));
    await editor.commit(value => ({ ...value, title: 'Accepted title' })); await settleEngine();
    gate = await hold(s, boundary);
    const form = editor.form('title', [['title']]); opening = form.begin(); void opening.catch(() => undefined);
    await settleEngine(); expect(gate.entered).toBe(true);
    await accept(s); expect(s.h.server.value?.title).toBe('Accepted title');
    expect((await gate.list('owner')).some(request => request.id === gate!.earlier[0].id)).toBe(false);
    gate.release(); await opening;
    expect(form.getState()).toMatchObject({ value: { title: 'Accepted title', content: 'Kept words' },
      openingValue: { title: 'Accepted title' }, dirty: false, durable: true,
      record: { baseline: { value: { title: 'Accepted title' } }, predecessor: null } });
    expect(s.h.transport.send).toHaveBeenCalledTimes(1);
  } finally { gate?.release(); await opening?.catch(() => undefined); s.browser.dispose(); }
});

it('keeps the chosen words when a later accepted title arrives, and refuses to overwrite it silently', async () => {
  const s = setup(); let gate: Awaited<ReturnType<typeof hold>> | undefined, opening: Promise<void> | undefined;
  try {
    const editor = await s.engine.openEditor(resource, s.browser.editorId(resource));
    await editor.commit(value => ({ ...value, title: 'Chosen title' })); await settleEngine();
    gate = await hold(s, 'request list'); const form = editor.form('title', [['title']]); opening = form.begin(); void opening.catch(() => undefined);
    await settleEngine(); await accept(s); await s.h.remote({ title: 'Later stored title' }); await settleEngine();
    expect(editor.getState().checkpoint.draft?.title).toBe('Later stored title');
    gate.release(); await opening;
    expect(form.getState()).toMatchObject({ value: { title: 'Chosen title' }, openingValue: { title: 'Chosen title' },
      record: { baseline: { value: { title: 'Chosen title' } }, predecessor: null } });
    await form.update(value => ({ ...value, title: 'Chosen title revised' })); await form.save(); await s.engine.retry(); await settleEngine();
    expect(s.h.server.value?.title).toBe('Later stored title');
    expect(await gate.list('owner')).toEqual(expect.arrayContaining([expect.objectContaining({ state: 'conflict', value: expect.objectContaining({ title: 'Chosen title revised' }) })]));
  } finally { gate?.release(); await opening?.catch(() => undefined); s.browser.dispose(); }
});

it('does not submit private unselected words with the opening field', async () => {
  const s = setup(); let gate: Awaited<ReturnType<typeof hold>> | undefined, opening: Promise<void> | undefined;
  try {
    const editor = await s.engine.openEditor(resource, s.browser.editorId(resource));
    await editor.commit(value => ({ ...value, title: 'Accepted title' }));
    await editor.edit({ ...editor.getState().checkpoint.draft!, content: 'Private unsent words' }); await settleEngine();
    gate = await hold(s, 'request list'); const form = editor.form('title', [['title']]); opening = form.begin(); void opening.catch(() => undefined);
    await settleEngine(); await accept(s); gate.release(); await opening;
    expect(form.getState()?.value).toMatchObject({ title: 'Accepted title', content: 'Kept words' });
    expect(editor.getState().checkpoint.draft).toMatchObject({ content: 'Private unsent words' });
    await form.update(value => ({ ...value, title: 'Revised title' })); await form.save(); await s.engine.retry(); await settleEngine();
    expect(s.h.server.value).toMatchObject({ title: 'Revised title', content: 'Kept words' });
    expect(editor.getState().checkpoint).toMatchObject({ draft: { content: 'Private unsent words' }, dirty: true });
  } finally { gate?.release(); await opening?.catch(() => undefined); s.browser.dispose(); }
});

it('retains the original genuinely pending predecessor without submitting on open', async () => {
  const s = setup();
  try {
    const editor = await s.engine.openEditor(resource, s.browser.editorId(resource));
    await editor.commit(value => ({ ...value, title: 'Pending title' })); await settleEngine();
    const before = await s.h.commits.list('owner'); const form = editor.form('title', [['title']]); await form.begin();
    expect(form.getState()).toMatchObject({ value: { title: 'Pending title' }, dirty: false, durable: true, record: { predecessor: { id: before[0].id } } });
    expect((await s.h.commits.list('owner')).map(request => request.id)).toEqual([before[0].id]);
    expect(s.h.transport.send).not.toHaveBeenCalled(); expect(s.h.server.value?.title).toBe('Opening title');
  } finally { s.browser.dispose(); }
});

it('does not adopt unsubmitted typing in a selected field', async () => {
  const s = setup();
  try {
    const editor = await s.engine.openEditor(resource, s.browser.editorId(resource));
    await editor.edit({ ...editor.getState().checkpoint.draft!, title: 'Private selected title' });
    await expect(editor.form('title', [['title']]).begin()).rejects.toThrow('An unsaved editor already owns a selected field');
    expect(editor.getState().checkpoint.draft?.title).toBe('Private selected title');
    expect(await s.h.commits.list('owner')).toEqual([]); expect(s.h.transport.send).not.toHaveBeenCalled();
  } finally { s.browser.dispose(); }
});

it.each(['owner change', 'parent close'] as const)('rejects delayed capture after %s without reviving its form', async change => {
  const s = setup(); let gate: Awaited<ReturnType<typeof hold>> | undefined, opening: Promise<void> | undefined;
  try {
    const editor = await s.engine.openEditor(resource, s.browser.editorId(resource));
    await editor.commit(value => ({ ...value, title: 'Pending title' })); await settleEngine(); gate = await hold(s, 'request list');
    const form = editor.form('title', [['title']]); opening = form.begin(); void opening.catch(() => undefined); await settleEngine();
    if (change === 'owner change') s.engine.setOwner('another-owner'); else editor.dispose();
    gate.release(); await expect(opening).rejects.toThrow();
    expect((await gate.list('owner'))[0]).toMatchObject({ id: gate.earlier[0].id, value: { title: 'Pending title' } });
    expect(await s.store.list('owner')).toEqual([]); expect(s.h.transport.send).not.toHaveBeenCalled();
  } finally { gate?.release(); await opening?.catch(() => undefined); s.browser.dispose(); }
});

it('propagates a scope disk error without retrying', async () => {
  const s = setup();
  try {
    const editor = await s.engine.openEditor(resource, s.browser.editorId(resource));
    const create = jest.spyOn(s.store, 'create').mockRejectedValue(new Error('Disk full'));
    await expect(editor.form('title', [['title']]).begin()).rejects.toThrow('Disk full'); expect(create).toHaveBeenCalledTimes(1);
    expect(await s.h.commits.list('owner')).toEqual([]); expect(s.h.transport.send).not.toHaveBeenCalled();
  } finally { s.browser.dispose(); }
});

it('bounds repeated stale-reference failures and creates no request', async () => {
  const s = setup();
  try {
    const editor = await s.engine.openEditor(resource, s.browser.editorId(resource));
    const create = jest.spyOn(s.store, 'create').mockRejectedValue(Object.assign(new Error('Saved request reference changed'), { code: 'commit-reference-changed' }));
    await expect(editor.form('title', [['title']]).begin()).rejects.toMatchObject({ code: 'commit-reference-changed' });
    expect(create.mock.calls.length).toBeGreaterThanOrEqual(1); expect(create.mock.calls.length).toBeLessThanOrEqual(3);
    expect(await s.h.commits.list('owner')).toEqual([]); expect(s.h.transport.send).not.toHaveBeenCalled();
  } finally { s.browser.dispose(); }
});

it('keeps a valid retained predecessor when acceptance arrives after capture', async () => {
  const s = setup(); let gate: Awaited<ReturnType<typeof hold>> | undefined, opening: Promise<void> | undefined;
  try {
    const editor = await s.engine.openEditor(resource, s.browser.editorId(resource));
    await editor.commit(value => ({ ...value, title: 'Retained accepted title' })); await settleEngine();
    const retainedEditorId = s.browser.editorId(resource);
    await s.h.checkpoints.create({ owner: 'owner', editorId: retainedEditorId, checkpoint: editor.getState().checkpoint, prepared: null, unfinalized: [] });
    gate = await hold(s, 'scope create'); const form = editor.form('title', [['title']]); opening = form.begin(); void opening.catch(() => undefined);
    await settleEngine(); expect(gate.entered).toBe(true); await accept(s);
    expect((await gate.list('owner'))[0]).toMatchObject({ id: gate.earlier[0].id, state: 'acknowledged' });
    gate.release(); await opening;
    expect(form.getState()).toMatchObject({ value: { title: 'Retained accepted title' }, durable: true, record: { predecessor: { id: gate.earlier[0].id } } });
    await form.update(value => ({ ...value, title: 'Later field edit' })); await form.save(); await s.engine.retry(); await settleEngine();
    expect(s.h.server.value?.title).toBe('Later field edit');
    expect(s.h.transport.send).toHaveBeenCalledTimes(2);
  } finally { gate?.release(); await opening?.catch(() => undefined); s.browser.dispose(); }
});
