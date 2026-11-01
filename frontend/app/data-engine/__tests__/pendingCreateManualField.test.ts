import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';
import type { DocumentData, Json, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const pendingResource = { collection: 'sermons', id: 'pending-prep-create' };
const createdSermon: DocumentData = {
  userId: 'owner', title: 'Created offline', verse: 'John 3:16', date: 'now', thoughts: [],
};
const prepPath = ['preparation', 'mainIdea', 'contextIdea'] as const;
const titlePath = ['title'] as const;

const serverWords = (h: ReturnType<typeof documentEngineHarness>) => {
  const { rev: _serverRevisions, ...authored } = h.server.value!;
  return authored;
};

function replaceAt(current: DocumentData, path: readonly string[], value: Json): DocumentData {
  const [key, ...rest] = path;
  if (!key) throw new Error('A selected path is required');
  if (!rest.length) return { ...current, [key]: value };
  const previous = current[key];
  const nested = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous as DocumentData : {};
  return { ...current, [key]: replaceAt(nested, rest, value) };
}

async function startPendingCreate() {
  const h = documentEngineHarness({ resource: pendingResource, value: null, metadata: null });
  let browser = h.createBrowser();
  browser.engine.setOnline(false);
  browser.engine.setOwner('owner');
  const creator = await browser.engine.createEditor(pendingResource, 'pending-create-editor');
  await creator.commit(() => createdSermon);
  await creator.close({ flush: false });
  const detail = await browser.engine.openEditor(pendingResource, 'pending-detail-editor');
  expect(detail.getState().checkpoint).toMatchObject({
    confirmed: { resource: pendingResource, value: null, metadata: null }, draft: createdSermon,
  });
  expect(h.transport.send).not.toHaveBeenCalled();
  return {
    h,
    detail,
    get browser() { return browser; },
    async replaceBrowser() {
      browser.dispose();
      await settleEngine();
      browser = h.createBrowser();
      browser.engine.setOnline(false);
      browser.engine.setOwner('owner');
      return browser;
    },
  };
}

it.each([
  { label: 'absent preparation path', slot: 'prep-mainIdea-contextIdea', path: prepPath, value: 'Saved preparation while sermon is pending' },
  { label: 'existing title', slot: 'title', path: titlePath, value: 'Saved title while sermon is pending' },
] as const)('saves a selected $label after the local create and delivers one document once', async ({ slot, path, value }) => {
  const s = await startPendingCreate();
  try {
    const detail = s.detail;
    const form = detail.form(slot, [path]);
    await form.begin();
    expect(form.getState()?.record.baseline.value).toBeNull();
    expect(form.getState()?.record.predecessor?.value).toEqual(createdSermon);
    await form.update(current => replaceAt(current, path, value));
    await form.save();

    const requests = (await s.h.commits.list('owner')).filter(request => request.baseline.resource.id === pendingResource.id);
    expect(requests).toHaveLength(2);
    const create = requests.find(request => request.predecessor === null)!;
    const fieldSave = requests.find(request => request.id === form.getState()?.record.predecessor?.id)!;
    expect(create.value).toEqual(createdSermon);
    expect(fieldSave.predecessor).toBe(create.id);
    expect(fieldSave.value).toEqual(replaceAt(createdSermon, path, value));
    expect(requests.every(request => ['queued', 'prepared'].includes(request.state))).toBe(true);
    expect(s.h.server.value).toBeNull();
    expect(s.h.transport.send).not.toHaveBeenCalled();

    s.browser.engine.setOnline(true);
    await s.browser.engine.retry();
    await settleEngine();
    expect(serverWords(s.h)).toEqual(replaceAt(createdSermon, path, value));
    expect(jest.mocked(s.h.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['create', 'update']);
    expect(s.h.server.resource).toEqual(pendingResource);
  } finally { s.browser.dispose(); await settleEngine(); }
});

it('cancels an unsent field stage without changing or cancelling its pending create', async () => {
  const s = await startPendingCreate();
  try {
    const detail = s.detail;
    const form = detail.form('prep-mainIdea-contextIdea', [prepPath]);
    await form.begin();
    await form.update(current => replaceAt(current, prepPath, 'Unsent field words'));
    await form.cancel();
    const requests = (await s.h.commits.list('owner')).filter(request => request.baseline.resource.id === pendingResource.id);
    expect(requests).toHaveLength(1);
    expect(requests[0].value).toEqual(createdSermon);
    expect(['queued', 'prepared']).toContain(requests[0].state);
    expect(s.h.transport.send).not.toHaveBeenCalled();

    s.browser.engine.setOnline(true);
    await s.browser.engine.retry();
    await settleEngine();
    expect(serverWords(s.h)).toEqual(createdSermon);
    expect(s.h.server.value).not.toHaveProperty('preparation.mainIdea.contextIdea');
    expect(jest.mocked(s.h.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['create']);
  } finally { s.browser.dispose(); await settleEngine(); }
});

it('restores the exact saved manual stage after browser replacement over its pending create', async () => {
  const s = await startPendingCreate();
  let browser = s.browser;
  try {
    const detail = s.detail;
    const form = detail.form('prep-mainIdea-contextIdea', [prepPath]);
    await form.begin();
    await form.update(current => replaceAt(current, prepPath, 'Saved field words'));
    await form.save(); await form.begin();
    await form.update(current => replaceAt(current, prepPath, 'Later unsent words'));
    const scopeId = form.getState()!.record.scopeId;
    const savedRequestId = form.getState()!.record.predecessor!.id;
    expect(form.getState()).toMatchObject({ dirty: true, durable: true });
    expect(s.h.server.value).toBeNull();

    browser = await s.replaceBrowser();
    const reopened = await browser.engine.openEditor(pendingResource, 'pending-detail-editor');
    const recovered = reopened.form('prep-mainIdea-contextIdea', [prepPath]);
    await recovered.begin();
    expect(recovered.getState()).toMatchObject({
      dirty: true, durable: true,
      value: { ...createdSermon, preparation: { mainIdea: { contextIdea: 'Later unsent words' } } },
      record: { scopeId, predecessor: { id: savedRequestId,
        value: { ...createdSermon, preparation: { mainIdea: { contextIdea: 'Saved field words' } } } } },
    });
    const requests = (await s.h.commits.list('owner')).filter(request => request.baseline.resource.id === pendingResource.id);
    const create = requests.find(request => request.predecessor === null)!;
    const savedField = requests.find(request => request.id === savedRequestId)!;
    expect(savedField.predecessor).toBe(create.id);

    browser.engine.setOnline(true);
    await browser.engine.retry();
    await settleEngine();
    expect(serverWords(s.h)).toEqual({ ...createdSermon, preparation: { mainIdea: { contextIdea: 'Saved field words' } } });
    expect(recovered.getState()?.dirty).toBe(true);
    expect(s.h.server.value?.preparation).not.toEqual({ mainIdea: { contextIdea: 'Later unsent words' } });
    expect(jest.mocked(s.h.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['create', 'update']);
  } finally { browser.dispose(); await settleEngine(); }
});

it('still rejects a manual form for an absent document with no saved create', async () => {
  const h = documentEngineHarness({ resource: pendingResource, value: null, metadata: null });
  const browser = h.createBrowser();
  browser.engine.setOnline(false); browser.engine.setOwner('owner');
  try {
    const editor = await browser.engine.openEditor(pendingResource, 'absent-reader');
    const form = editor.form('prep-mainIdea-contextIdea', [prepPath]);
    await expect(form.begin()).rejects.toThrow('Manual form requires a live confirmed document');
    expect(await h.commits.list('owner')).toEqual([]);
    expect(h.transport.send).not.toHaveBeenCalled();
  } finally { browser.dispose(); await settleEngine(); }
});

it('still rejects a manual form for a tombstoned document', async () => {
  const tombstone: ResourceSnapshot = {
    resource: pendingResource, value: null,
    metadata: { protocol: 1, generation: 'deleted', revision: 2, deleted: true },
  };
  const h = documentEngineHarness(tombstone);
  const browser = h.createBrowser();
  browser.engine.setOnline(false); browser.engine.setOwner('owner');
  try {
    const editor = await browser.engine.openEditor(pendingResource, 'deleted-reader');
    const form = editor.form('prep-mainIdea-contextIdea', [prepPath]);
    await expect(form.begin()).rejects.toThrow('Manual form requires a live confirmed document');
    expect(await h.commits.list('owner')).toEqual([]);
    expect(h.server).toEqual(tombstone);
    expect(h.transport.send).not.toHaveBeenCalled();
  } finally { browser.dispose(); await settleEngine(); }
});

it('does not open a form over unsubmitted creation typing', async () => {
  const h = documentEngineHarness({ resource: pendingResource, value: null, metadata: null });
  const browser = h.createBrowser(); browser.engine.setOnline(false); browser.engine.setOwner('owner');
  try {
    const creator = await browser.engine.createEditor(pendingResource, 'unsubmitted-create');
    await creator.edit(createdSermon); await creator.close({ flush: false });
    const reader = await browser.engine.openEditor(pendingResource, 'unsent-reader');
    await expect(reader.form('title', [titlePath]).begin()).rejects.toThrow('Manual form requires a live confirmed document');
    expect(await h.commits.list('owner')).toEqual([]);
    expect(h.transport.send).not.toHaveBeenCalled();
  } finally { browser.dispose(); await settleEngine(); }
});

it('retains staged preparation and blocks ordinary Save after its creation is refused', async () => {
  const s = await startPendingCreate();
  try {
    const form = s.detail.form('prep-mainIdea-contextIdea', [prepPath]); await form.begin();
    await form.update(current => replaceAt(current, prepPath, 'Correction after refused creation'));
    jest.mocked(s.h.transport.send).mockImplementationOnce(async command => ({ kind: 'refused', operationId: command.operationId, code: 'permission-denied' }));
    s.browser.engine.setOnline(true); await s.browser.engine.retry(); await settleEngine();
    await expect(form.save()).rejects.toMatchObject({ code: 'resolve-version-first' });
    expect(form.getState()).toMatchObject({ durable: true, dirty: true, value: { preparation: { mainIdea: { contextIdea: 'Correction after refused creation' } } } });
    expect(s.h.server.value).toBeNull();
    const requests = await s.h.commits.list('owner'); expect(requests).toHaveLength(1); expect(requests[0].state).toBe('refused');
  } finally { s.browser.dispose(); await settleEngine(); }
});

it('opens the captured creation when its ACK arrives during the manual opening read', async () => {
  const s = await startPendingCreate(); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    const list = s.h.commits.list.bind(s.h.commits); const requests = await list('owner');
    let entered = false;
    jest.spyOn(s.h.commits, 'list').mockImplementationOnce(async () => { entered = true; await held; return requests; });
    const form = s.detail.form('prep-mainIdea-contextIdea', [prepPath]); const opening = form.begin(); void opening.catch(() => undefined);
    await settleEngine(); expect(entered).toBe(true);
    s.browser.engine.setOnline(true); await s.browser.engine.retry(); await settleEngine();
    expect(serverWords(s.h)).toEqual(createdSermon);
    release(); await opening;
    expect(form.getState()).toMatchObject({ dirty: false, value: createdSermon });
    await form.update(current => replaceAt(current, prepPath, 'Prepared after ACK')); await form.save(); await s.browser.engine.retry(); await settleEngine();
    expect(serverWords(s.h)).toEqual(replaceAt(createdSermon, prepPath, 'Prepared after ACK'));
  } finally { release?.(); s.browser.dispose(); await settleEngine(); jest.restoreAllMocks(); }
});

it.each(['creation', 'existing document'] as const)('blocks manual Save after a local-policy refusal on an %s without a wire command', async kind => {
  const existing = kind === 'existing document';
  const h = documentEngineHarness({ resource: pendingResource, value: existing ? createdSermon : null,
    metadata: existing ? { protocol: 1, generation: 'g', revision: 1, deleted: false } : null });
  const browser = h.createBrowser(); browser.engine.setOnline(false); browser.engine.setOwner('owner');
  try {
    const editor = existing ? await browser.engine.openEditor(pendingResource, 'local-refusal') : await browser.engine.createEditor(pendingResource, 'local-refusal');
    await editor.commit(() => ({ ...createdSermon, seriesId: 'series-1' })); await browser.engine.retry(); await settleEngine();
    expect(await h.commits.list('owner')).toEqual([expect.objectContaining({ state: 'refused', command: null, result: { kind: 'refused', operationId: expect.any(String), code: 'relation-owner-required' } })]);
    const form = editor.form('title', [titlePath]); await form.begin();
    await form.update(current => ({ ...current, title: 'Retained correction' }));
    await expect(form.save()).rejects.toMatchObject({ code: 'resolve-version-first' });
    expect(form.getState()).toMatchObject({ durable: true, dirty: true, value: { title: 'Retained correction' } });
    expect(await h.commits.list('owner')).toHaveLength(1);
    expect(h.transport.send).not.toHaveBeenCalled();
    expect(h.server.value).toEqual(existing ? createdSermon : null);
  } finally { browser.dispose(); await settleEngine(); }
});
