import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import type { CommitRequest } from '../commits';
import type { CollectionState } from '../collections';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'studyNotes', id: 'note' };
const snapshot = { resource, value: { userId: 'owner', title: 'Opening title', content: 'Kept words', tags: [], scriptureRefs: [], isDraft: false,
  createdAt: '2026-10-18', updatedAt: '2026-10-18' }, metadata: { protocol: 1 as const, generation: 'g1', revision: 1, deleted: false } };

it.each(['readCollection', 'refreshCollection'] as const)('returns known acceptance when an earlier %s request list finishes', async method => {
  const h = documentEngineHarness(snapshot), browser = h.createBrowser({ withCollections: true });
  const engine = browser.engine;
  engine.setOnline(false); engine.setOwner('owner');
  const originalList = h.commits.list.bind(h.commits);
  let release!: () => void;
  let reading: Promise<CollectionState> | undefined;
  try {
    const editor = await engine.openEditor(resource, browser.editorId(resource));
    await editor.commit(value => ({ ...value, title: 'Accepted title' }));
    await settleEngine();
    const earlier = await originalList('owner');
    expect(['queued', 'prepared']).toContain(earlier[0].state);
    const held = new Promise<CommitRequest[]>(resolve => { release = () => resolve(earlier); });
    let heldReadStarted = false;
    jest.spyOn(h.commits, 'list').mockImplementationOnce(() => { heldReadStarted = true; return held; });
    reading = engine[method]('studyNotes');
    void reading.catch(() => undefined);
    await settleEngine();
    expect(heldReadStarted).toBe(true);
    engine.setOnline(true); await engine.retry(); await settleEngine();
    expect(h.server.value?.title).toBe('Accepted title');
    expect((await engine.peekCollectionCached('studyNotes')).documents?.[0]).toMatchObject({ pending: false, value: { title: 'Accepted title' } });
    release();
    const answer = await reading;
    expect(answer.documents?.[0]).toMatchObject({ pending: false, value: { title: 'Accepted title', content: 'Kept words' } });
    expect((await engine.peekCollectionCached('studyNotes')).documents?.[0]).toMatchObject({ pending: false, value: { title: 'Accepted title' } });
  } finally { release?.(); await reading?.catch(() => undefined); browser.dispose(); }
});


it.each(['readCollection', 'refreshCollection'] as const)('includes work captured while an earlier %s empty list was waiting', async method => {
  const h = documentEngineHarness(snapshot), browser = h.createBrowser({ withCollections: true });
  const engine = browser.engine;
  engine.setOnline(false); engine.setOwner('owner');
  let release!: () => void;
  let reading: Promise<CollectionState> | undefined;
  try {
    const editor = await engine.openEditor(resource, browser.editorId(resource));
    const held = new Promise<CommitRequest[]>(resolve => { release = () => resolve([]); });
    let heldReadStarted = false;
    jest.spyOn(h.commits, 'list').mockImplementationOnce(() => { heldReadStarted = true; return held; });
    reading = engine[method]('studyNotes'); void reading.catch(() => undefined);
    await settleEngine(); expect(heldReadStarted).toBe(true);
    await editor.commit(value => ({ ...value, title: 'Later pending title' })); await settleEngine();
    expect(h.server.value?.title).toBe('Opening title');
    expect((await engine.peekCollectionCached('studyNotes')).documents?.[0]).toMatchObject({ pending: true, value: { title: 'Later pending title' } });
    release(); const answer = await reading;
    expect(answer.documents?.[0]).toMatchObject({ pending: true, value: { title: 'Later pending title' } });
    expect(answer.snapshots[0].value?.title).toBe('Opening title');
  } finally { release?.(); await reading?.catch(() => undefined); browser.dispose(); }
});

it.each(['readCollection', 'refreshCollection'] as const)('loads durable unseen requests for a cold %s reader', async method => {
  const h = documentEngineHarness(snapshot), writer = h.createBrowser({ withCollections: true });
  writer.engine.setOnline(false); writer.engine.setOwner('owner');
  let reader: ReturnType<typeof h.createBrowser> | undefined;
  try {
    const editor = await writer.engine.openEditor(resource, writer.editorId(resource));
    await editor.commit(value => ({ ...value, title: 'Durable pending title' })); await settleEngine();
    reader = h.createBrowser({ withCollections: true }); reader.engine.setOnline(false); reader.engine.setOwner('owner');
    const answer = await reader.engine[method]('studyNotes');
    expect(answer.documents?.[0]).toMatchObject({ pending: true, value: { title: 'Durable pending title' } });
    expect(answer.snapshots[0].value?.title).toBe('Opening title');
    expect(h.transport.send).not.toHaveBeenCalled();
  } finally { reader?.dispose(); writer.dispose(); }
});

it.each(['readCollection', 'refreshCollection'] as const)('rejects an old owner %s result before publishing it for another owner', async method => {
  const h = documentEngineHarness(snapshot), browser = h.createBrowser({ withCollections: true });
  const engine = browser.engine;
  engine.setOnline(false); engine.setOwner('owner');
  let release!: () => void;
  let reading: Promise<CollectionState> | undefined;
  try {
    const editor = await engine.openEditor(resource, browser.editorId(resource));
    await editor.commit(value => ({ ...value, title: 'Original owner title' })); await settleEngine();
    const originalList = h.commits.list.bind(h.commits), records = await originalList('owner');
    const held = new Promise<CommitRequest[]>(resolve => { release = () => resolve(records); });
    jest.spyOn(h.commits, 'list').mockImplementationOnce(() => held);
    reading = engine[method]('studyNotes'); void reading.catch(() => undefined);
    await settleEngine(); engine.setOwner('next-owner'); release();
    await expect(reading).rejects.toThrow('Account changed');
    expect((await engine.peekCollectionCached('studyNotes')).documents).toEqual([]);
    expect((await originalList('owner'))[0].value?.title).toBe('Original owner title');
  } finally { release?.(); await reading?.catch(() => undefined); browser.dispose(); }
});


it.each(['readCollection', 'refreshCollection'] as const)('includes a new resource captured while an earlier %s request list was empty', async method => {
  const h = documentEngineHarness(snapshot), browser = h.createBrowser({ withCollections: true });
  const engine = browser.engine, createdResource = { collection: 'studyNotes', id: 'new-note' };
  engine.setOnline(false); engine.setOwner('owner');
  let release!: () => void;
  let reading: Promise<CollectionState> | undefined;
  try {
    const editor = await engine.createEditor(createdResource, browser.editorId(createdResource));
    const held = new Promise<CommitRequest[]>(resolve => { release = () => resolve([]); });
    let heldReadStarted = false;
    jest.spyOn(h.commits, 'list').mockImplementationOnce(() => { heldReadStarted = true; return held; });
    reading = engine[method]('studyNotes'); void reading.catch(() => undefined);
    await settleEngine(); expect(heldReadStarted).toBe(true);
    await editor.commit(() => ({ ...snapshot.value, title: 'New pending note' })); await settleEngine();
    expect((await engine.peekCollectionCached('studyNotes')).documents?.some(row => row.resource.id === createdResource.id && row.pending)).toBe(true);
    release(); const answer = await reading;
    expect(answer.documents?.some(row => row.resource.id === createdResource.id && row.value?.title === 'New pending note' && row.pending)).toBe(true);
    expect(answer.snapshots.some(row => row.resource.id === createdResource.id)).toBe(false);
    expect(h.server.value?.title).toBe('Opening title');
    expect(h.transport.send).not.toHaveBeenCalled();
  } finally { release?.(); await reading?.catch(() => undefined); browser.dispose(); }
});
