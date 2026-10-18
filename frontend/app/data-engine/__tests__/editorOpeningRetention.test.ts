import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import type { CommitRequest } from '../commits';
import type { ManagedEditor } from '../engine';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'studyNotes', id: 'note' };
const snapshot = { resource, value: { userId: 'owner', title: 'Opening title', content: 'Kept words', tags: [], scriptureRefs: [], isDraft: false,
  createdAt: '2026-10-18', updatedAt: '2026-10-18' }, metadata: { protocol: 1 as const, generation: 'g1', revision: 1, deleted: false } };

it.each(['request list', 'checkpoint read', 'request list with private remainder'] as const)('opens accepted words when delivery finishes during an earlier %s', async boundary => {
  const h = documentEngineHarness(snapshot), browser = h.createBrowser({ withCollections: true });
  const engine = browser.engine;
  engine.setOnline(false); engine.setOwner('owner');
  let release!: () => void;
  let opening: Promise<ManagedEditor> | undefined;
  try {
    const writerId = browser.editorId(resource);
    const writer = await engine.openEditor(resource, writerId);
    await writer.commit(value => ({ ...value, title: 'Accepted title' })); await settleEngine();
    const list = h.commits.list.bind(h.commits), earlier = await list('owner');
    expect(earlier).toHaveLength(1); expect(['queued', 'prepared']).toContain(earlier[0].state);
    let heldStarted = false;
    if (boundary !== 'checkpoint read') {
      const held = new Promise<CommitRequest[]>(resolve => { release = () => resolve(earlier); });
      jest.spyOn(h.commits, 'list').mockImplementationOnce(() => { heldStarted = true; return held; });
    } else {
      const held = new Promise<undefined>(resolve => { release = () => resolve(undefined); });
      jest.spyOn(h.checkpoints, 'read').mockImplementationOnce(() => { heldStarted = true; return held; });
    }
    opening = engine.openEditor(resource, browser.editorId(resource)); void opening.catch(() => undefined);
    await settleEngine(); expect(heldStarted).toBe(true);
    if (boundary === 'request list with private remainder') await writer.edit({ ...writer.getState().checkpoint.draft!, content: 'Private unwritten remainder' });
    engine.setOnline(true); await engine.retry(); await settleEngine();
    expect(h.server.value?.title).toBe('Accepted title');
    expect((await list('owner')).some(request => request.id === earlier[0].id)).toBe(false);
    release(); const editor = await opening; await settleEngine();
    expect(editor.getState().checkpoint).toMatchObject({ confirmed: { value: { title: 'Accepted title', content: 'Kept words' } },
      draft: { title: 'Accepted title', content: 'Kept words' }, pending: {}, dirty: false });
    expect(editor.getState().error).toBeNull();
    if (boundary === 'request list with private remainder') {
      expect(writer.getState().checkpoint).toMatchObject({ draft: { content: 'Private unwritten remainder' }, dirty: true, pending: {} });
      expect((await h.checkpoints.read('owner', writerId))?.checkpoint.draft?.content).toBe('Private unwritten remainder');
    }
    expect(h.transport.send).toHaveBeenCalledTimes(1);
  } finally { release?.(); await opening?.then(editor => editor.dispose()).catch(() => undefined); browser.dispose(); }
});

it('resumes genuinely pending work with its original identity', async () => {
  const h = documentEngineHarness(snapshot), browser = h.createBrowser({ withCollections: true });
  browser.engine.setOnline(false); browser.engine.setOwner('owner');
  try {
    const writer = await browser.engine.openEditor(resource, browser.editorId(resource));
    await writer.commit(value => ({ ...value, title: 'Pending title' })); await settleEngine();
    const requests = await h.commits.list('owner'); expect(requests).toHaveLength(1);
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource)); await settleEngine();
    expect(editor.getState().checkpoint.draft?.title).toBe('Pending title');
    expect(Object.keys(editor.getState().checkpoint.pending)).toEqual([requests[0].id]);
    expect((await h.commits.list('owner')).map(request => request.id)).toEqual([requests[0].id]);
    expect(h.server.value?.title).toBe('Opening title'); expect(h.transport.send).not.toHaveBeenCalled();
  } finally { browser.dispose(); }
});

it('rejects delayed opening after an account change without changing the original work', async () => {
  const h = documentEngineHarness(snapshot), browser = h.createBrowser({ withCollections: true });
  browser.engine.setOnline(false); browser.engine.setOwner('owner');
  let release!: () => void;
  let opening: Promise<ManagedEditor> | undefined;
  try {
    const writer = await browser.engine.openEditor(resource, browser.editorId(resource));
    await writer.commit(value => ({ ...value, title: 'Original owner title' })); await settleEngine();
    const list = h.commits.list.bind(h.commits), requests = await list('owner');
    const held = new Promise<CommitRequest[]>(resolve => { release = () => resolve(requests); });
    jest.spyOn(h.commits, 'list').mockImplementationOnce(() => held);
    opening = browser.engine.openEditor(resource, browser.editorId(resource)); void opening.catch(() => undefined);
    await settleEngine(); browser.engine.setOwner('next-owner'); release();
    await expect(opening).rejects.toThrow('Account changed');
    expect((await list('owner'))[0]).toMatchObject({ id: requests[0].id, value: { title: 'Original owner title' } });
    expect(h.transport.send).not.toHaveBeenCalled();
  } finally { release?.(); await opening?.catch(() => undefined); browser.dispose(); }
});

it('opens a clean document without creating a request', async () => {
  const h = documentEngineHarness(snapshot), browser = h.createBrowser({ withCollections: true });
  browser.engine.setOnline(false); browser.engine.setOwner('owner');
  try {
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    expect(editor.getState().checkpoint).toMatchObject({ draft: { title: 'Opening title', content: 'Kept words' }, pending: {}, dirty: false });
    expect(await h.commits.list('owner')).toEqual([]); expect(h.transport.send).not.toHaveBeenCalled();
  } finally { browser.dispose(); }
});

it.each(['disk full', 'commit-reference-changed'] as const)('reports persistent %s instead of retrying forever or hiding it', async kind => {
  const h = documentEngineHarness(snapshot), browser = h.createBrowser();
  browser.engine.setOnline(false); browser.engine.setOwner('owner');
  const error = kind === 'disk full' ? new Error('Disk full') : Object.assign(new Error('Saved request reference changed'), { code: kind });
  const read = jest.spyOn(h.checkpoints, 'read').mockRejectedValue(error);
  try {
    await expect(browser.engine.openEditor(resource, browser.editorId(resource))).rejects.toBe(error);
    if (kind === 'disk full') expect(read).toHaveBeenCalledTimes(1);
    else expect(read.mock.calls.length).toBeLessThanOrEqual(3);
    expect(await h.commits.list('owner')).toEqual([]); expect(h.transport.send).not.toHaveBeenCalled();
  } finally { browser.dispose(); }
});

it('does not revive an aborted opening after its delayed read finishes', async () => {
  const h = documentEngineHarness(snapshot), browser = h.createBrowser();
  browser.engine.setOnline(false); browser.engine.setOwner('owner');
  let release!: () => void;
  let opening: Promise<ManagedEditor> | undefined;
  try {
    const writer = await browser.engine.openEditor(resource, browser.editorId(resource));
    await writer.commit(value => ({ ...value, title: 'Pending title' })); await settleEngine();
    const list = h.commits.list.bind(h.commits), requests = await list('owner');
    const held = new Promise<CommitRequest[]>(resolve => { release = () => resolve(requests); });
    let started = false;
    jest.spyOn(h.commits, 'list').mockImplementationOnce(() => { started = true; return held; });
    const identity = browser.editorId(resource), abort = new AbortController();
    opening = browser.engine.openEditor(resource, identity, { signal: abort.signal }); void opening.catch(() => undefined);
    await settleEngine(); expect(started).toBe(true); abort.abort(); release();
    await expect(opening).rejects.toMatchObject({ name: 'AbortError' }); await settleEngine();
    const explicit = await browser.engine.openEditor(resource, identity);
    expect(explicit.getState().checkpoint.draft?.title).toBe('Pending title');
    expect(Object.keys(explicit.getState().checkpoint.pending)).toEqual([requests[0].id]);
    expect(h.transport.send).not.toHaveBeenCalled();
  } finally { release?.(); await opening?.catch(() => undefined); browser.dispose(); }
});
