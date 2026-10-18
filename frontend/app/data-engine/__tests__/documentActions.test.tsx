import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider, useDocumentActions } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'sermons', id: 'sermon-1' };
const stored = { userId: 'owner', title: 'Grace', verse: 'John 1:14', date: '2026-09-01', thoughts: [], sourceNoteIds: ['note-a'] };

function setup() {
  const harness = documentEngineHarness({ resource, value: stored, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const wrapper = ({ children }: { children: React.ReactNode }) => <DataEngineProvider>{children}</DataEngineProvider>;
  return { harness, ...renderHook(() => useDocumentActions(), { wrapper }) };
}

describe('one action on a document no screen has open', () => {
  it('captures exactly this change as one durable command on the stored baseline', async () => {
    const { harness, result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.commit(resource, current => ({ ...current!, sourceNoteIds: [...(current!.sourceNoteIds as string[]), 'note-b'] }));
    });
    await waitFor(async () => { await settleEngine(); expect(harness.server.value?.sourceNoteIds).toEqual(['note-a', 'note-b']); });
    expect(harness.server.value?.title).toBe('Grace');
  });

  it('deletes through the engine, leaving a tombstone rather than an absent document', async () => {
    const { harness, result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { await result.current.remove(resource); });
    await waitFor(async () => { await settleEngine(); expect(harness.server.metadata?.deleted).toBe(true); });
    expect(harness.server.value).toBeNull();
  });

  it('accepts the exact captured write delivered by another worker through the shared durable queue', async () => {
    const { harness, result, unmount } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    harness.engine.setOnline(false);
    const original = harness.engine;
    const receipt = await result.current.submit(resource, { kind: 'update', update: current => ({ ...current!, title: 'From the first tab' }) });
    let accepted = false; void receipt.persistence.then(() => { accepted = true; });
    await settleEngine(); expect(accepted).toBe(false);
    const other = harness.createBrowser(); other.engine.setOnline(false); other.engine.setOwner('owner'); other.engine.setOnline(true);
    try {
      await other.engine.retry(); await settleEngine();
      expect(harness.server.value?.title).toBe('From the first tab');
      // Existing queue reads, rather than a render-map snapshot, discover the other worker's ACK.
      await original.retry();
      await expect(receipt.persistence).resolves.toMatchObject({ value: { title: 'From the first tab' } });
    } finally { other.dispose(); unmount(); }
  });

  it('returns the durable receipt when only the later editor checkpoint projection fails', async () => {
    const { harness, result, unmount } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    const put = harness.checkpoints.put;
    let failOnce = true;
    const projection = jest.spyOn(harness.checkpoints, 'put').mockImplementation(async record => {
      if (failOnce && Object.keys(record.checkpoint.pending).length) { failOnce = false; throw new Error('Checkpoint projection failed'); }
      return put(record);
    });
    const send = jest.mocked(harness.transport.send), deliver = send.getMockImplementation()!;
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    send.mockImplementation(async command => { await held; return deliver(command); });
    try {
      const captured = result.current.submit(resource, { kind: 'update', update: current => ({ ...current!, title: 'Durably submitted words' }) });
      await expect(captured).resolves.toMatchObject({ requestId: expect.any(String), kind: 'submitted' });
      const receipt = await captured;
      expect((await harness.commits.list('owner')).some(row => row.id === receipt.requestId)).toBe(true);
      expect(harness.server.value?.title).toBe('Grace');
      let accepted = false; void receipt.persistence.then(() => { accepted = true; });
      await settleEngine(); expect(accepted).toBe(false);
      release(); await harness.engine.retry();
      await expect(receipt.persistence).resolves.toMatchObject({ value: { title: 'Durably submitted words' } });
    } finally { release(); projection.mockRestore(); await harness.engine.retry(); unmount(); }
  });

  describe('a change the server did not accept as sent', () => {
    const conflicted = async () => {
      const context = setup();
      await waitFor(() => expect(context.result.current.ready).toBe(true));
      context.harness.silentRemote({ title: 'Written on the phone' });
      await act(async () => { await context.result.current.commit(resource, current => ({ ...current!, title: 'Written on the laptop' })); });
      await waitFor(async () => { await settleEngine(); expect(await context.harness.engine.listRecoverable(resource)).toHaveLength(1); });
      expect(context.harness.server.value?.title).toBe('Written on the phone');
      return context;
    };

    it('keeps this device\'s version when asked, and nothing is left waiting', async () => {
      const { harness, result } = await conflicted();
      let settled = 0;
      await act(async () => { settled = await result.current.resolve(resource, 'mine'); });
      expect(settled).toBe(1);
      await waitFor(async () => { await settleEngine(); expect(harness.server.value?.title).toBe('Written on the laptop'); });
      expect(harness.server.value?.sourceNoteIds).toEqual(['note-a']);
    });

    it('takes the stored version when asked, dropping this device\'s draft', async () => {
      const { harness, result } = await conflicted();
      await act(async () => { await result.current.resolve(resource, 'theirs'); });
      await settleEngine();
      expect(harness.server.value?.title).toBe('Written on the phone');
      expect(await harness.engine.listRecoverable(resource)).toHaveLength(0);
    });

    it('never cancels work that is only waiting for the network', async () => {
      const { harness, result } = setup();
      await waitFor(() => expect(result.current.ready).toBe(true));
      const send = jest.mocked(harness.transport.send);
      const deliver = send.getMockImplementation()!;
      send.mockImplementation(async () => { throw Object.assign(new TypeError('Failed to fetch'), { code: 'unavailable' }); });
      await act(async () => { await result.current.commit(resource, current => ({ ...current!, title: 'Typed offline' })); });
      await settleEngine();
      let settled = -1;
      await act(async () => { settled = await result.current.resolve(resource, 'theirs'); });
      expect(settled).toBe(0);
      send.mockImplementation(deliver);
      await act(async () => { await harness.engine.retry(resource); });
      await waitFor(async () => { await settleEngine(); expect(harness.server.value?.title).toBe('Typed offline'); });
    });
  });

  describe('a chain of one-shot saves answered after the fact', () => {
    const offlineChain = async (context: ReturnType<typeof setup>) => {
      await waitFor(() => expect(context.result.current.ready).toBe(true));
      const send = jest.mocked(context.harness.transport.send);
      const deliver = send.getMockImplementation()!;
      send.mockImplementation(async () => { throw Object.assign(new TypeError('Failed to fetch'), { code: 'unavailable' }); });
      for (const title of ['Draft one', 'Draft two', 'Draft three']) {
        await act(async () => { await context.result.current.commit(resource, current => ({ ...current!, title })); await settleEngine(); });
      }
      context.harness.silentRemote({ title: 'Written on the phone' });
      send.mockImplementation(deliver);
      await act(async () => { await context.harness.engine.retry(resource); await settleEngine(); await settleEngine(); });
    };

    it('never chooses among several drafts: mine is refused, theirs retires them all', async () => {
      const context = setup();
      await offlineChain(context);
      expect(await context.harness.engine.listRecoverable(resource)).toHaveLength(3);
      await expect(context.result.current.resolve(resource, 'mine')).rejects.toMatchObject({ code: 'ambiguous-choice' });
      await act(async () => { await context.result.current.resolve(resource, 'theirs'); await settleEngine(); });
      expect(context.harness.server.value?.title).toBe('Written on the phone');
      expect(await context.harness.engine.listRecoverable(resource)).toHaveLength(0);
      await act(async () => { await context.result.current.commit(resource, current => ({ ...current!, verse: 'Romans 8:28' })); await settleEngine(); await settleEngine(); });
      await waitFor(async () => { await settleEngine(); expect(context.harness.server.value?.verse).toBe('Romans 8:28'); });
    });

    it('takes no further one-shot change while an answer waits, so nothing piles up behind it', async () => {
      const { harness, result } = setup();
      await waitFor(() => expect(result.current.ready).toBe(true));
      harness.silentRemote({ title: 'Written on the phone' });
      await act(async () => { await result.current.commit(resource, current => ({ ...current!, title: 'Written on the laptop' })); await settleEngine(); await settleEngine(); });
      await waitFor(async () => { await settleEngine(); expect(await harness.engine.listRecoverable(resource)).toHaveLength(1); });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await expect(result.current.commit(resource, current => ({ ...current!, title: `Retry ${attempt}` }))).rejects.toMatchObject({ code: 'decision-required' });
      }
      expect(await harness.engine.listRecoverable(resource)).toHaveLength(1);
    });

    it('drops a refused change on "theirs", so the next save is not stuck behind it', async () => {
      const { harness, result } = setup();
      await waitFor(() => expect(result.current.ready).toBe(true));
      await act(async () => { await result.current.commit(resource, current => ({ ...current!, title: 42 as never })); await settleEngine(); await settleEngine(); });
      await expect(result.current.commit(resource, current => ({ ...current!, verse: 'John 3:16' }))).rejects.toMatchObject({ code: 'decision-required' });
      await act(async () => { await result.current.resolve(resource, 'theirs'); await settleEngine(); });
      expect(await harness.engine.listRecoverable(resource)).toHaveLength(0);
      await act(async () => { await result.current.commit(resource, current => ({ ...current!, verse: 'Romans 8:28' })); await settleEngine(); await settleEngine(); });
      await waitFor(async () => { await settleEngine(); expect(harness.server.value?.verse).toBe('Romans 8:28'); });
      expect(harness.server.value?.title).toBe('Grace');
    });
  });
});
