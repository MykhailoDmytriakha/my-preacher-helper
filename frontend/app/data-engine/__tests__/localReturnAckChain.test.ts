import { waitFor } from '@testing-library/react';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';
import { editorIdentity } from '@/data-engine/editorIdentity';

import type { ResourceSnapshot } from '@/data-engine/types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/services/firebaseAuth.service', () => ({ auth: { currentUser: null } }));

const owner = 'ack-chain-probe-owner';
const original = { userId: owner, title: 'Opening', status: 'draft', templates: [], flow: [], createdAt: 'now', updatedAt: 'now' };
const snapshot = (id: string): ResourceSnapshot => ({
  resource: { collection: 'groups', id }, value: original,
  metadata: { protocol: 1, generation: `${id}-g1`, revision: 1, deleted: false },
});

function openSet(id: string, includeC = false) {
  const h = documentEngineHarness(snapshot(id));
  const a = h.createBrowser().engine;
  const b = h.createBrowser().engine;
  const c = includeC ? h.createBrowser().engine : undefined;
  for (const engine of [a, b, ...(c ? [c] : [])]) { engine.setOnline(false); engine.setOwner(owner); }
  const editorIdA = editorIdentity('tab-A', { collection: 'groups', id }, 'group', `${id}-A`);
  const editorIdB = editorIdentity('tab-B', { collection: 'groups', id }, 'group', `${id}-B`);
  const editorIdC = editorIdentity('tab-C', { collection: 'groups', id }, 'group', `${id}-C`);
  return { h, a, b, c, editorIdA, editorIdB, editorIdC };
}

it('adopts a new root based on A revision 2 after A revision 1 was fully ACKed and collected', async () => {
  const { h, a, b, editorIdA, editorIdB } = openSet('ack-chain-a');
  try {
    const inA = await a.openEditor({ collection: 'groups', id: 'ack-chain-a' }, editorIdA);
    const inB = await b.openEditor({ collection: 'groups', id: 'ack-chain-a' }, editorIdB);
    b.setVisible(false);
    await inA.commit(value => ({ ...value!, title: 'A first accepted edit' }));
    a.setOnline(true); await a.retry(); await settleEngine(); await settleEngine();
    expect(h.server.value?.title).toBe('A first accepted edit');
    expect(await h.commits.list(owner)).toEqual([]);
    a.setOnline(false);
    await inA.commit(value => ({ ...value!, title: 'A second saved edit' }));
    const [second] = await h.commits.list(owner);
    expect(second.predecessor).toBeNull();
    expect(second.baseline.metadata?.revision).toBe(2);
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('A second saved edit'), { timeout: 2500 });
  } finally { a.dispose(); b.dispose(); }
});

it('shows A second queued child while its send is held after the first ACK', async () => {
  const { h, a, b, c, editorIdA, editorIdB, editorIdC } = openSet('ack-chain-b', true);
  let releaseSecond!: () => void;
  let secondStarted!: () => void;
  const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
  const secondCall = new Promise<void>(resolve => { secondStarted = resolve; });
  let retrying: Promise<unknown> | undefined;
  try {
    const inA = await a.openEditor({ collection: 'groups', id: 'ack-chain-b' }, editorIdA);
    const inB = await b.openEditor({ collection: 'groups', id: 'ack-chain-b' }, editorIdB);
    b.setVisible(false);
    await inA.commit(value => ({ ...value!, title: 'A first queued edit' }));
    const cEditor = await c!.openEditor({ collection: 'groups', id: 'ack-chain-b' }, editorIdC);
    await waitFor(async () => expect((await h.checkpoints.read(owner, editorIdC))?.checkpoint.pending).not.toEqual({}));
    await inA.commit(value => ({ ...value!, title: 'A second queued edit' }));
    const rows = await h.commits.list(owner);
    const first = rows.find(row => row.value?.title === 'A first queued edit')!;
    const second = rows.find(row => row.value?.title === 'A second queued edit')!;
    expect(second.predecessor).toBe(first.id);

    const send = jest.mocked(h.transport.send).getMockImplementation();
    if (!send) throw new Error('Harness send implementation is missing');
    let calls = 0;
    jest.mocked(h.transport.send).mockImplementation(async command => {
      calls += 1;
      if (calls === 2) { secondStarted(); await secondGate; }
      return send(command);
    });
    a.setOnline(true);
    retrying = a.retry();
    await waitFor(() => expect(calls).toBe(2));
    await secondCall;
    expect(h.server.value?.title).toBe('A first queued edit');
    expect((await h.commits.list(owner)).find(row => row.id === second.id)?.state).not.toBe('acknowledged');

    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('A second queued edit'), { timeout: 2500 });
    expect(inB.getState().checkpoint.pending[second.id]).toBeDefined();
    expect(h.server.value?.title).toBe('A first queued edit');
    expect(cEditor.getState().checkpoint.pending[first.id]).toBeDefined();
  } finally {
    releaseSecond?.(); await retrying?.catch(() => undefined); await settleEngine();
    a.dispose(); b.dispose(); c?.dispose();
  }
});

it('recovers an active B editor if A collects ACK between B admission and checkpoint write', async () => {
  const { h, a, b, editorIdA, editorIdB } = openSet('ack-chain-c');
  const put = h.checkpoints.put.bind(h.checkpoints);
  let entered!: () => void;
  let allowWrite!: () => void;
  const enteredGate = new Promise<void>(resolve => { entered = resolve; });
  const writeGate = new Promise<void>(resolve => { allowWrite = resolve; });
  let gated = false;
  let targetId = '';
  let spy: jest.SpyInstance | undefined;
  try {
    const inA = await a.openEditor({ collection: 'groups', id: 'ack-chain-c' }, editorIdA);
    const inB = await b.openEditor({ collection: 'groups', id: 'ack-chain-c' }, editorIdB);
    b.setVisible(false);
    await inA.commit(value => ({ ...value!, title: 'A accepted while B returns' }));
    const [request] = await h.commits.list(owner); targetId = request.id;
    spy = jest.spyOn(h.checkpoints, 'put').mockImplementation(async record => {
      if (!gated && record.owner === owner && record.editorId === editorIdB && record.checkpoint.pending[targetId]) {
        gated = true; entered(); await writeGate;
      }
      return put(record);
    });

    b.setVisible(true);
    await enteredGate;
    a.setOnline(true); await a.retry(); await settleEngine(); await settleEngine();
    expect(h.server.value?.title).toBe('A accepted while B returns');
    expect(await h.commits.list(owner)).toEqual([]);

    allowWrite(); await settleEngine(); await settleEngine();
    b.setVisible(false); b.setVisible(true); await settleEngine(); await settleEngine();
    await waitFor(() => expect(inB.getState().checkpoint.pending[targetId]).toBeUndefined(), { timeout: 2500 });
    expect(inB.getState().checkpoint.draft?.title).toBe('A accepted while B returns');
    expect(inB.getState().checkpoint.confirmed.value?.title).toBe('A accepted while B returns');
  } finally {
    allowWrite?.(); spy?.mockRestore(); a.dispose(); b.dispose();
  }
});
