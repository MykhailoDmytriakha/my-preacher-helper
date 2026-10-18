import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import type { CommitRequest } from '../commits';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'studyNotes', id: 'note' };
const snapshot = { resource, value: { userId: 'owner', title: 'Opening title', content: 'Kept words', tags: [], scriptureRefs: [], isDraft: false,
  createdAt: '2026-10-18', updatedAt: '2026-10-18' }, metadata: { protocol: 1 as const, generation: 'g1', revision: 1, deleted: false } };

it.each(['manual form', 'editor manual restore', 'collection watcher'] as const)
  ('keeps an accepted collection row settled after an older %s read finishes', async mode => {
  const h = documentEngineHarness(snapshot), browser = h.createBrowser({ withCollections: true });
  const engine = browser.engine;
  engine.setOnline(false); engine.setOwner('owner');
  const originalList = h.commits.list.bind(h.commits);
  let release!: () => void;
  let opening: Promise<unknown> | undefined;
  let stop: (() => void) | undefined;
  try {
    const editor = await engine.openEditor(resource, browser.editorId(resource));
    await editor.commit(value => ({ ...value, title: 'Accepted title' }));
    await settleEngine();
    expect((await engine.peekCollectionCached('studyNotes')).documents?.[0]).toMatchObject({ pending: true, value: { title: 'Accepted title' } });
    const queued = await originalList('owner');
    expect(['queued', 'prepared']).toContain(queued[0].state);
    const held = new Promise<CommitRequest[]>(resolve => { release = () => resolve(queued); });
    const holdAt = mode === 'editor manual restore' ? 3 : 1;
    let reads = 0;
    jest.spyOn(h.commits, 'list').mockImplementation(owner => ++reads === holdAt ? held : originalList(owner));
    const form = editor.form('content', [['content']]);
    if (mode === 'manual form') opening = form.begin();
    else if (mode === 'collection watcher') { stop = engine.watchCollection('studyNotes', () => undefined); opening = Promise.resolve(); }
    else opening = engine.openEditor(resource, browser.editorId(resource));
    void opening.catch(() => undefined);
    await settleEngine();
    expect(reads).toBe(holdAt);
    engine.setOnline(true); await engine.retry(); await settleEngine();
    expect(h.server.value?.title).toBe('Accepted title');
    expect((await engine.peekCollectionCached('studyNotes')).documents?.[0]).toMatchObject({ pending: false, value: { title: 'Accepted title' } });
    release(); await opening;
    if (mode === 'manual form') expect(form.getState()?.value.content).toBe('Kept words');
    expect((await engine.peekCollectionCached('studyNotes')).documents?.[0]).toMatchObject({ pending: false, value: { title: 'Accepted title' } });
    expect(h.server.value?.title).toBe('Accepted title');
    engine.setOnline(false);
    await editor.commit(value => ({ ...value, content: 'Later unsent words' }));
    await settleEngine();
    expect((await engine.peekCollectionCached('studyNotes')).documents?.[0]).toMatchObject({ pending: true, value: { content: 'Later unsent words' } });
    expect(h.server.value?.content).toBe('Kept words');
    engine.setOnline(true); await engine.retry(); await settleEngine();
    expect((await engine.peekCollectionCached('studyNotes')).documents?.[0]).toMatchObject({ pending: false, value: { content: 'Later unsent words' } });
  } finally { release?.(); await opening?.catch(() => undefined); stop?.(); browser.dispose(); }
});


it('rejects an old owner form load before it can repopulate the next owner map', async () => {
  const h = documentEngineHarness(snapshot), browser = h.createBrowser({ withCollections: true });
  const engine = browser.engine;
  engine.setOnline(false); engine.setOwner('owner');
  let release!: () => void;
  let opening: Promise<void> | undefined;
  try {
    const editor = await engine.openEditor(resource, browser.editorId(resource));
    await editor.commit(value => ({ ...value, title: 'Original owner words' }));
    await settleEngine();
    const originalList = h.commits.list.bind(h.commits), records = await originalList('owner');
    const held = new Promise<CommitRequest[]>(resolve => { release = () => resolve(records); });
    jest.spyOn(h.commits, 'list').mockImplementationOnce(() => held);
    opening = editor.form('content', [['content']]).begin();
    void opening.catch(() => undefined);
    await settleEngine();
    engine.setOwner('next-owner');
    release();
    await expect(opening).rejects.toThrow('Account changed');
    expect((await engine.peekCollectionCached('studyNotes')).documents).toEqual([]);
    expect((await originalList('owner'))[0].value?.title).toBe('Original owner words');
    expect(h.transport.send).not.toHaveBeenCalled();
  } finally { release?.(); await opening?.catch(() => undefined); browser.dispose(); }
});
