import { waitFor } from '@testing-library/react';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';
import { editorIdentity } from '@/data-engine/editorIdentity';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const resource = { collection: 'groups', id: 'offline-group-279' };
const original = { userId: 'owner', title: 'Opening group', status: 'draft', templates: [], flow: [], createdAt: 'now', updatedAt: 'now' };
const setup = async () => {
  const h = documentEngineHarness({ resource, value: original, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  const a = h.createBrowser().engine, b = h.createBrowser().engine;
  a.setOnline(false); a.setOwner('owner'); b.setOnline(false); b.setOwner('owner');
  const inA = await a.openEditor(resource, editorIdentity('tab-A', resource, 'group', 'opening-A'));
  const inB = await b.openEditor(resource, editorIdentity('tab-B', resource, 'group', 'opening-B'));
  return { h, a, b, inA, inB };
};

it('shows the saved offline title in an already-open clean second editor after returning', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'Saved locally in A' }));
    await settleEngine(); await settleEngine();
    const fresh = await b.openEditor(resource, editorIdentity('tab-B', resource, 'group', 'fresh-readback'));
    expect(fresh.getState().checkpoint.draft?.title).toBe('Saved locally in A');
    expect(h.server.value?.title).toBe('Opening group');
    b.setVisible(true); await settleEngine(); await settleEngine();
    expect(inB.getState().checkpoint.draft?.title).toBe('Saved locally in A');
  } finally { a.dispose(); b.dispose(); }
});

it('keeps private unsaved words in B while A saves the same field offline', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    await inB.edit({ ...original, title: 'Private unsaved B' });
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'Saved locally in A' }));
    b.setVisible(true); await settleEngine(); await settleEngine();
    expect(inB.getState().checkpoint.draft?.title).toBe('Private unsaved B');
    const requests = await h.commits.list('owner');
    expect(requests.some(r => r.value?.title === 'Saved locally in A')).toBe(true);
    expect(requests.some(r => r.value?.title === 'Private unsaved B')).toBe(false);
    expect(h.server.value?.title).toBe('Opening group');
  } finally { a.dispose(); b.dispose(); }
});


it('continues B after the captured A edit and delivers the continuation without a stale overwrite', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'Saved locally in A' }));
    b.setVisible(true); await settleEngine(); await settleEngine();
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Saved locally in A'));
    await inB.commit(current => ({ ...current!, title: 'Continued in B' }));
    const records = await h.commits.list('owner');
    const first = records.find(request => request.value?.title === 'Saved locally in A')!;
    const second = records.find(request => request.value?.title === 'Continued in B')!;
    expect(second.predecessor).toBe(first.id);
    b.setOnline(true); await b.retry(); await settleEngine(); await settleEngine();
    a.setOnline(true); await a.retry(); await settleEngine();
    expect(h.server.value?.title).toBe('Continued in B');
    expect(inB.getState().checkpoint.conflicts).toEqual([]);
  } finally { a.dispose(); b.dispose(); }
});

it('reads the whole saved A chain while leaving its confirmed baseline unchanged', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'First A words' }));
    await inA.commit(current => ({ ...current!, title: 'Last A words' }));
    b.setVisible(true); await settleEngine(); await settleEngine();
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Last A words'));
    const state = inB.getState().checkpoint;
    expect(state.draft?.title).toBe('Last A words');
    expect(state.confirmed.value?.title).toBe('Opening group');
    expect(Object.keys(state.pending)).toHaveLength(2);
    expect(h.transport.send).not.toHaveBeenCalled();
  } finally { a.dispose(); b.dispose(); }
});

it('keeps two already captured independent roots separate on return', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'Independent A words' }));
    await inB.commit(current => ({ ...current!, title: 'Independent B words' }));
    b.setVisible(true); await settleEngine(); await settleEngine();
    expect(inB.getState().checkpoint.draft?.title).toBe('Independent B words');
    expect((await h.commits.list('owner')).filter(request => !request.predecessor)).toHaveLength(2);
    expect(h.transport.send).not.toHaveBeenCalled();
  } finally { a.dispose(); b.dispose(); }
});

it('shows an accepted A edit even if its request was already collected before B returned', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'Accepted A words' }));
    a.setOnline(true); await a.retry(); await settleEngine(); await settleEngine();
    expect(h.server.value?.title).toBe('Accepted A words');
    expect(await h.commits.list('owner')).toEqual([]);
    const calls = jest.mocked(h.transport.read).mock.calls.length;
    b.setVisible(true); await settleEngine(); await settleEngine();
    expect(inB.getState().checkpoint.draft?.title).toBe('Accepted A words');
    expect(inB.getState().checkpoint.confirmed).toEqual(h.server);
    expect(inB.getState().checkpoint.pending).toEqual({});
    expect(jest.mocked(h.transport.read).mock.calls).toHaveLength(calls);
  } finally { a.dispose(); b.dispose(); }
});

it('keeps typing that arrives while the return read is waiting', async () => {
  const { h, a, b, inA, inB } = await setup();
  let release: (() => void) | undefined;
  const originalList = h.commits.list.bind(h.commits);
  let spy: jest.SpyInstance | undefined;
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'Saved locally in A' }));
    await settleEngine(); await settleEngine();
    const held = new Promise<void>(resolve => { release = resolve; });
    let reading = false;
    spy = jest.spyOn(h.commits, 'list').mockImplementationOnce(async owner => {
      const records = await originalList(owner); reading = true; await held; return records;
    });
    b.setVisible(true); await settleEngine();
    expect(reading).toBe(true);
    await inB.edit({ ...original, title: 'Typed during the read' });
    release!(); await settleEngine(); await settleEngine();
    expect(inB.getState().checkpoint.draft?.title).toBe('Typed during the read');
    expect(inB.getState().checkpoint.pending).toEqual({});
    expect(h.server.value?.title).toBe('Opening group');
  } finally { release?.(); spy?.mockRestore(); a.dispose(); b.dispose(); }
});


it('retries an unchanged saved root after private typing is put back', async () => {
  const { a, b, inA, inB } = await setup();
  try {
    await inB.edit({ ...original, title: 'Private B words' });
    b.setVisible(false); await inA.commit(current => ({ ...current!, title: 'Saved locally in A' }));
    b.setVisible(true); await settleEngine(); await settleEngine();
    expect(inB.getState().checkpoint.draft?.title).toBe('Private B words');
    await inB.edit(original);
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Saved locally in A'));
  } finally { a.dispose(); b.dispose(); }
});

it('keeps an active private form and follows the saved root only after it closes', async () => {
  const { a, b, inA, inB } = await setup();
  try {
    const form = inB.form('title', [['title']]);
    await form.begin(); await form.update(value => ({ ...value, title: 'Private form words' }));
    b.setVisible(false); await inA.commit(current => ({ ...current!, title: 'Saved locally in A' }));
    b.setVisible(true); await settleEngine(); await settleEngine();
    expect(inB.getState().checkpoint.draft?.title).toBe('Opening group');
    expect(form.getState()?.value.title).toBe('Private form words');
    await form.cancel(); b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Saved locally in A'));
  } finally { a.dispose(); b.dispose(); }
});

it('replays the real ACK retained by the adopted B checkpoint on its next return', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    b.setVisible(false); await inA.commit(current => ({ ...current!, title: 'Saved locally in A' }));
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Saved locally in A'));
    await waitFor(() => expect(inB.getState().durable).toBe(true));
    const id = Object.keys(inB.getState().checkpoint.pending)[0]; expect(id).toBeDefined();
    b.setVisible(false); a.setOnline(true); await a.retry(); await settleEngine(); await settleEngine();
    const held = (await h.commits.list('owner')).find(request => request.id === id);
    expect(held?.state).toBe('acknowledged');
    expect((await h.checkpoints.read('owner', editorIdentity('tab-B', resource, 'group', 'opening-B')))?.checkpoint.pending[id]).toBeDefined();
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.pending).toEqual({}));
    expect(inB.getState().checkpoint.confirmed).toEqual(h.server);
    expect(inB.getState().checkpoint.draft?.title).toBe('Saved locally in A');
  } finally { a.dispose(); b.dispose(); }
});

it('does not publish a return read into an account that replaced its owner', async () => {
  const { h, a, b, inA, inB } = await setup();
  let release: (() => void) | undefined;
  const originalList = h.commits.list.bind(h.commits);
  let spy: jest.SpyInstance | undefined;
  try {
    b.setVisible(false); await inA.commit(current => ({ ...current!, title: 'Saved locally in A' }));
    await settleEngine(); await settleEngine();
    const held = new Promise<void>(resolve => { release = resolve; });
    let reading = false;
    spy = jest.spyOn(h.commits, 'list').mockImplementationOnce(async owner => {
      const records = await originalList(owner); reading = true; await held; return records;
    });
    b.setVisible(true); await settleEngine(); expect(reading).toBe(true);
    b.setOwner('other'); release!(); await settleEngine(); await settleEngine();
    expect(() => inB.getState()).toThrow();
    expect(b.getPending()).toEqual([]);
    expect(inA.getState().checkpoint.draft?.title).toBe('Saved locally in A');
  } finally { release?.(); spy?.mockRestore(); a.dispose(); b.dispose(); }
});

it('refreshes a visible offline collection through the same return path', async () => {
  const h = documentEngineHarness({ resource, value: original, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  const a = h.createBrowser().engine, b = h.createBrowser({ withCollections: true }).engine;
  a.setOnline(false); a.setOwner('owner'); b.setOnline(false); b.setOwner('owner');
  let title: unknown, pending: unknown;
  const stop = b.watchCollection('groups', state => { title = state.documents?.[0]?.value?.title; pending = state.documents?.[0]?.pending; });
  try {
    const inA = await a.openEditor(resource, editorIdentity('tab-A', resource, 'group', 'opening-A'));
    await waitFor(() => expect(title).toBe('Opening group'));
    b.setVisible(false); await inA.commit(current => ({ ...current!, title: 'Saved locally in A' }));
    b.setVisible(true); await waitFor(() => expect(title).toBe('Saved locally in A'));
    expect(pending).toBe(true); expect(h.transport.send).not.toHaveBeenCalled();
    b.setVisible(false); a.setOnline(true); await a.retry(); await settleEngine(); await settleEngine();
    expect(await h.commits.list('owner')).toEqual([]);
    const calls = jest.mocked(h.transport.read).mock.calls.length;
    b.setVisible(true); await waitFor(() => expect(pending).toBe(false));
    expect(title).toBe('Saved locally in A');
    expect(jest.mocked(h.transport.read).mock.calls).toHaveLength(calls);
  } finally { stop(); a.dispose(); b.dispose(); }
});


it('follows saved local work while an automatically opened form is still untouched', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    const form = inB.form('group-meeting', [['meetingDates']]);
    await form.begin();
    expect(form.getState()?.record.active).toBe(true);
    expect(form.getState()?.dirty).toBe(false);
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'Saved while the date form is open' }));
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Saved while the date form is open'));
    expect(form.getState()?.record.active).toBe(true);
    expect(form.getState()?.dirty).toBe(false);
    expect(h.server.value?.title).toBe('Opening group');
  } finally { a.dispose(); b.dispose(); }
});
