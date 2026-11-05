import { waitFor } from '@testing-library/react';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';
import { editorIdentity } from '../editorIdentity';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const owner = 'owner';
async function setup(id: string) {
  const resource = { collection: 'groups', id };
  const original = { userId: owner, title: 'Original', status: 'draft', templates: [], flow: [], createdAt: 'now', updatedAt: 'now' };
  const h = documentEngineHarness({ resource, value: original, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } });
  const a = h.createBrowser().engine, b = h.createBrowser().engine;
  a.setOnline(false); a.setOwner(owner); b.setOnline(false); b.setOwner(owner);
  const idA = editorIdentity('tab-A', resource, 'group', 'a'), idB = editorIdentity('tab-B', resource, 'group', 'b');
  const inA = await a.openEditor(resource, idA), inB = await b.openEditor(resource, idB);
  b.setVisible(false); await inA.commit(value => ({ ...value!, title: 'Saved A' }));
  await settleEngine(); await settleEngine();
  const request = (await h.commits.list(owner)).find(row => row.value?.title === 'Saved A')!;
  return { h, a, b, inA, inB, idB, resource, original, request, close: () => { a.dispose(); b.dispose(); } };
}
function gateCandidate(s: Awaited<ReturnType<typeof setup>>, afterNativeCommit = false) {
  let reached = false, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const put = s.h.checkpoints.put.bind(s.h.checkpoints);
  const spy = afterNativeCommit ? undefined : jest.spyOn(s.h.checkpoints, 'put').mockImplementation(async record => {
    if (!reached && record.editorId === s.idB && record.checkpoint.pending[s.request.id]) { reached = true; await held; }
    return put(record);
  });
  if (afterNativeCommit) s.h.storage.holdCompletionAfterCommit = (rows, mode) => {
    const record = rows.get(JSON.stringify(['checkpoint', owner, s.idB])) as { checkpoint?: { pending: Record<string, unknown> } } | undefined;
    if (!reached && mode === 'readwrite' && record?.checkpoint?.pending[s.request.id]) { reached = true; return true; }
    return false;
  };
  return { reached: () => reached, release: () => { release(); if (afterNativeCommit) s.h.storage.finishCompletion(); },
    restore: () => { spy?.mockRestore(); s.h.storage.holdCompletionAfterCommit = undefined; } };
}

it('keeps private typing that starts while the invisible candidate checkpoint is waiting', async () => {
  const s = await setup('pin-private'), gate = gateCandidate(s);
  let editing: Promise<void> | undefined;
  try {
    s.b.setVisible(true); await waitFor(() => expect(gate.reached()).toBe(true));
    expect(s.inB.getState().checkpoint.draft?.title).toBe('Original');
    editing = s.inB.edit({ ...s.original, title: 'Private B while waiting' });
    expect(s.inB.getState().checkpoint.draft?.title).toBe('Private B while waiting');
    gate.release(); await editing;
    await waitFor(() => expect(s.inB.getState().durable).toBe(true));
    expect(s.inB.getState().checkpoint.pending).toEqual({});
    expect((await s.h.checkpoints.read(owner, s.idB))?.checkpoint.draft?.title).toBe('Private B while waiting');
    expect((await s.h.commits.list(owner)).some(row => row.id === s.request.id)).toBe(true);
    expect(s.h.transport.send).not.toHaveBeenCalled();
  } finally { gate.release(); await editing?.catch(() => undefined); gate.restore(); s.close(); }
});

it('preserves later typing when the screen closes after native candidate commit but before callback', async () => {
  const s = await setup('pin-close'), gate = gateCandidate(s, true);
  let editing: Promise<void> | undefined;
  try {
    s.b.setVisible(true); await waitFor(() => expect(gate.reached()).toBe(true));
    editing = s.inB.edit({ ...s.original, title: 'Private B before leaving' });
    s.inB.close({ flush: false }); gate.release();
    await editing.catch(() => undefined);
    await waitFor(async () => expect((await s.h.checkpoints.read(owner, s.idB))?.checkpoint.draft?.title).toBe('Private B before leaving'));
    expect((await s.h.checkpoints.read(owner, s.idB))?.checkpoint.pending).toEqual({});
  } finally { gate.release(); await editing?.catch(() => undefined); gate.restore(); s.close(); }
});

it('keeps retired private typing under the original owner after account replacement during candidate callback', async () => {
  const s = await setup('pin-owner'), gate = gateCandidate(s, true);
  let editing: Promise<void> | undefined;
  try {
    s.b.setVisible(true); await waitFor(() => expect(gate.reached()).toBe(true));
    editing = s.inB.edit({ ...s.original, title: 'Original owner private B' });
    s.b.setOwner('other'); gate.release(); await editing.catch(() => undefined);
    await waitFor(async () => expect((await s.h.checkpoints.read(owner, s.idB))?.checkpoint.draft?.title).toBe('Original owner private B'));
    expect(await s.h.checkpoints.read('other', s.idB)).toBeUndefined();
    expect(s.b.getPending()).toEqual([]);
  } finally { gate.release(); await editing?.catch(() => undefined); gate.restore(); s.close(); }
});

it('rechecks an ACK revision that advances while the candidate put still has valid references', async () => {
  const s = await setup('pin-ack'), gate = gateCandidate(s);
  const c = s.h.createBrowser().engine; c.setOnline(false); c.setOwner(owner);
  try {
    await c.openEditor(s.resource, editorIdentity('tab-C', s.resource, 'group', 'c'));
    s.b.setVisible(true); await waitFor(() => expect(gate.reached()).toBe(true));
    s.a.setOnline(true); await s.a.retry(); await settleEngine(); await settleEngine();
    expect((await s.h.commits.list(owner)).find(row => row.id === s.request.id)?.state).toBe('acknowledged');
    gate.release();
    await waitFor(() => expect(s.inB.getState().checkpoint.confirmed).toEqual(s.h.server));
    expect(s.inB.getState().checkpoint.draft?.title).toBe('Saved A');
    expect(s.inB.getState().checkpoint.pending).toEqual({});
    expect(s.inB.getState().error).toBeNull();
  } finally { gate.release(); gate.restore(); c.dispose(); s.close(); }
});

it('continues above an existing editor generation watermark instead of replaying an old capture', async () => {
  const s = await setup('pin-generation');
  try {
    s.a.setOnline(true); await s.a.retry(); await settleEngine(); await settleEngine();
    s.b.setVisible(true); await waitFor(() => expect(s.inB.getState().checkpoint.draft?.title).toBe('Saved A'));
    s.b.setOnline(true); await s.inB.commit(value => ({ ...value!, title: 'Accepted B' }));
    await s.b.retry(); await settleEngine(); await settleEngine();
    const before = s.inB.getState().checkpoint.editGeneration;
    s.a.setVisible(true); await waitFor(() => expect(s.inA.getState().checkpoint.draft?.title).toBe('Accepted B'));
    s.a.setOnline(false); s.b.setOnline(false); s.b.setVisible(false);
    await s.inA.commit(value => ({ ...value!, title: 'Next saved A' }));
    s.b.setVisible(true); await waitFor(() => expect(s.inB.getState().checkpoint.draft?.title).toBe('Next saved A'));
    expect(s.inB.getState().checkpoint.editGeneration).toBeGreaterThan(before);
    await s.inB.commit(value => ({ ...value!, title: 'New B capture' }));
    expect((await s.h.commits.list(owner)).find(row => row.value?.title === 'New B capture')?.editGeneration).toBeGreaterThan(before);
    s.b.setOnline(true); await s.b.retry(); await settleEngine(); await settleEngine();
    expect(s.h.server.value?.title).toBe('New B capture');
  } finally { s.close(); }
});


it('preserves manual words typed while an untouched form permits the candidate checkpoint', async () => {
  const s = await setup('pin-manual-stage');
  const form = s.inB.form('group-meeting', [['meetingDates']]);
  await form.begin();
  const gate = gateCandidate(s);
  try {
    s.b.setVisible(true); await waitFor(() => expect(gate.reached()).toBe(true));
    await form.update(value => ({ ...value, meetingDates: [{ id: 'meeting', date: '', location: 'Private meeting words', createdAt: 'now' }] }));
    expect(form.getState()?.dirty).toBe(true);
    gate.release(); await settleEngine(); await settleEngine();
    expect(s.inB.getState().checkpoint.draft?.title).toBe('Original');
    expect(s.inB.getState().checkpoint.pending).toEqual({});
    expect(form.getState()?.value.meetingDates).toEqual([{ id: 'meeting', date: '', location: 'Private meeting words', createdAt: 'now' }]);
    expect(form.getState()?.durable).toBe(true);
    expect((await s.h.commits.list(owner)).some(row => row.id === s.request.id)).toBe(true);
    expect(s.h.transport.send).not.toHaveBeenCalled();
  } finally { gate.release(); gate.restore(); s.close(); }
});
