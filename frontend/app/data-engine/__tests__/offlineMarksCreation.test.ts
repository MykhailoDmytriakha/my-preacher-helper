import { documentEngineHarness, settleEngine } from '../../../test-utils/documentEngineHarness';

import type { DocumentData, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'bibleMarks', id: 'owner_rst_isaiah' };
const fields = { userId: 'owner', bible: 'rst', book: 'Isaiah', createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z' };
const book = (verses: DocumentData): DocumentData => ({ ...fields, verses });
const stored = (verses: DocumentData): ResourceSnapshot => ({ resource, value: book(verses), metadata: { protocol: 1, generation: 'existing-book', revision: 1, deleted: false } });

async function offlineBook(verses: DocumentData) {
  const harness = documentEngineHarness(stored(verses), { cached: false });
  const errors: unknown[] = [];
  const engine = harness.createBrowser({ onError: error => errors.push(error) }).engine;
  engine.setOnline(false); engine.setOwner('owner');
  const editor = await engine.createEditor(resource, 'offline-book');
  return { harness, engine, editor, errors };
}

describe('First offline Bible marks book', () => {
  it('keeps an offline captured stroke queued without a command until a fresh target can be read', async () => {
    const { harness, engine, editor, errors } = await offlineBook({ v26_3: { p: '0-1-blue' } });
    try {
      await editor.commit(() => book({ v26_4: { m: '0-0-red' } }));
      await engine.retry(); await settleEngine();
      const [request] = await harness.commits.list('owner');
      expect(request.value?.verses).toEqual({ v26_4: { m: '0-0-red' } });
      expect(request.command).toBeNull();
      expect(request.state).toBe('queued');
      expect(harness.transport.read).not.toHaveBeenCalled();
      expect(harness.transport.send).not.toHaveBeenCalled();
      expect(errors).toEqual([]);
    } finally { engine.dispose(); }
  });

  it.each([
    [{ v26_3: { p: '0-1-blue' } }, { v26_4: { m: '0-0-red' } }, { v26_3: { p: '0-1-blue' }, v26_4: { m: '0-0-red' } }],
    [{ v26_4: { p: '0-1-blue' } }, { v26_4: { m: '0-0-red' } }, { v26_4: { p: '0-1-blue', m: '0-0-red' } }],
  ])('combines independent first-book marks after reconnect: %j', async (remote, local, combined) => {
    const { harness, engine, editor } = await offlineBook(remote);
    try {
      await editor.commit(() => book(local));
      engine.setVisible(false); engine.setOnline(true);
      await engine.retry(); await settleEngine();
      expect(harness.server.value?.verses).toEqual(combined);
      expect(editor.getState().checkpoint.draft?.verses).toEqual(combined);
      expect(editor.getState().checkpoint.dirty).toBe(false);
      expect(harness.transport.read).toHaveBeenCalledWith('owner', resource, { fresh: true });
      expect(jest.mocked(harness.transport.send).mock.calls[0][0]).toMatchObject({ kind: 'update', generation: 'existing-book' });
    } finally { engine.dispose(); }
  });

  it.each([
    { storedBook: '2 Corinthians', accepted: true },
    { storedBook: '2-corinthians', accepted: true },
    { storedBook: '2 CORINTHIANS', accepted: true },
    { storedBook: '1-corinthians', accepted: false },
  ])('uses the canonical marks identity for first offline strokes: $storedBook', async ({ storedBook, accepted }) => {
    const resource = { collection: 'bibleMarks', id: 'owner_kjv_2-corinthians' };
    const remote: ResourceSnapshot = {
      resource,
      value: { ...fields, bible: 'kjv', book: storedBook, verses: { v4_6: { m: '0-3-yellow,5-8-blue', p: '4-4-gray' } } },
      metadata: { protocol: 1, generation: 'existing-book', revision: 1, deleted: false },
    };
    const harness = documentEngineHarness(remote, { cached: false });
    const engine = harness.createBrowser().engine;
    engine.setOnline(false);
    engine.setOwner('owner');
    const editor = await engine.createEditor(resource, 'offline-book-label');
    try {
      await editor.commit(() => ({ ...fields, bible: 'kjv', book: '2 Corinthians', verses: { v4_6: { m: '11-11-red' } } }));
      await editor.commit(value => ({ ...value, verses: { v4_6: { m: '11-11-red,14-14-red' } } }));
      expect(harness.transport.send).not.toHaveBeenCalled();
      engine.setOnline(true);
      await engine.retry();
      await settleEngine();
      if (accepted) {
        expect(harness.server.value).toMatchObject({ book: storedBook,
          verses: { v4_6: { m: '0-3-yellow,5-8-blue,11-11-red,14-14-red', p: '4-4-gray' } } });
        expect(harness.transport.send).toHaveBeenCalledTimes(2);
      } else {
        expect(harness.server.value).toEqual(remote.value);
        expect(editor.getState().result).toMatchObject({ kind: 'refused', code: 'invalid-document' });
        expect(harness.transport.send).not.toHaveBeenCalled();
      }
    } finally { engine.dispose(); }
  });

  it('asks about the same layer and KeepMine retains the other verse and layer', async () => {
    const remote = { v26_3: { p: '0-1-blue' }, v26_4: { m: '0-0-green', p: '0-1-gray' } };
    const local = { v26_4: { m: '0-0-red' } };
    const { harness, engine, editor } = await offlineBook(remote);
    try {
      await editor.commit(() => book(local));
      engine.setOnline(true); await engine.retry(); await settleEngine();
      expect(editor.getState().result?.kind).toBe('conflict');
      expect(harness.server.value?.verses).toEqual(remote);
      await editor.keepLocal();
      expect(editor.getState().checkpoint.draft?.verses).toEqual({ v26_3: { p: '0-1-blue' }, v26_4: { m: '0-0-red', p: '0-1-gray' } });
      await editor.save(); await engine.retry(); await settleEngine();
      expect(harness.server.value?.verses).toEqual({ v26_3: { p: '0-1-blue' }, v26_4: { m: '0-0-red', p: '0-1-gray' } });
    } finally { engine.dispose(); }
  });

  it('delivers rapid captured successors after restart without dropping either device marks', async () => {
    const { harness, engine, editor } = await offlineBook({ v26_3: { p: '0-1-blue' } });
    await editor.commit(() => book({ v26_4: { m: '0-0-red' } }));
    await editor.commit(value => ({ ...value, verses: { ...(value!.verses as DocumentData), v26_5: { p: '0-0-gray' } } }));
    await engine.retry(); engine.dispose();
    const restarted = harness.createBrowser().engine;
    restarted.setOnline(false); restarted.setOwner('owner');
    try {
      restarted.setOnline(true); await restarted.retry(); await settleEngine();
      expect(harness.server.value?.verses).toEqual({ v26_3: { p: '0-1-blue' }, v26_4: { m: '0-0-red' }, v26_5: { p: '0-0-gray' } });
      expect((await harness.commits.list('owner')).every(request => request.state === 'acknowledged')).toBe(true);
    } finally { restarted.dispose(); }
  });

  it('keeps later unsent strokes private while projecting the first captured ACK', async () => {
    const { harness, engine, editor } = await offlineBook({ v26_3: { p: '0-1-blue' } });
    try {
      const first = book({ v26_4: { m: '0-0-red' } });
      await editor.commit(() => first);
      await editor.edit({ ...first, verses: { ...(first.verses as DocumentData), v26_5: { m: '0-0-green' } } });
      engine.setOnline(true); await engine.retry(); await settleEngine();
      expect(harness.server.value?.verses).toEqual({ v26_3: { p: '0-1-blue' }, v26_4: { m: '0-0-red' } });
      expect(editor.getState().checkpoint.draft?.verses).toEqual({ v26_3: { p: '0-1-blue' }, v26_4: { m: '0-0-red' }, v26_5: { m: '0-0-green' } });
      expect(editor.getState().checkpoint.dirty).toBe(true);
    } finally { engine.dispose(); }
  });

  it('recovers a legacy already-prepared refused create through explicit KeepMine', async () => {
    const remote = { v26_3: { p: '0-1-blue' }, v26_4: { p: '0-1-gray' } };
    const local = book({ v26_4: { m: '0-0-red' } });
    const { harness, engine, editor } = await offlineBook(remote);
    try {
      await editor.commit(() => local); await engine.retry();
      const [request] = await harness.commits.list('owner');
      const legacy = { protocol: 1 as const, owner: 'owner', operationId: request.id, resource, generation: null, dependsOn: [], kind: 'create' as const, value: local };
      await harness.commits.compareAndSet(request, { ...request, command: legacy, submitted: local, state: 'prepared' });
      engine.setOnline(true); await engine.retry(); await settleEngine();
      expect(editor.getState().result).toMatchObject({ kind: 'refused', code: 'generation-mismatch' });
      expect(harness.transport.read).not.toHaveBeenCalled();
      await editor.keepLocal();
      expect(editor.getState().checkpoint.draft?.verses).toEqual({ v26_3: { p: '0-1-blue' }, v26_4: { m: '0-0-red', p: '0-1-gray' } });
      await editor.save(); await engine.retry(); await settleEngine();
      expect(harness.server.value?.verses).toEqual({ v26_3: { p: '0-1-blue' }, v26_4: { m: '0-0-red', p: '0-1-gray' } });
      expect(jest.mocked(harness.transport.send).mock.calls[0][0]).toEqual(legacy);
    } finally { engine.dispose(); }
  });

  it('creates a genuinely absent book after the fresh target read', async () => {
    const harness = documentEngineHarness({ resource, value: null, metadata: null }, { cached: false });
    const engine = harness.createBrowser().engine;
    engine.setOnline(false); engine.setOwner('owner');
    try {
      const editor = await engine.createEditor(resource, 'new-book');
      await editor.commit(() => book({ v26_4: { m: '0-0-red' } }));
      engine.setOnline(true); await engine.retry(); await settleEngine();
      expect(harness.server.value?.verses).toEqual({ v26_4: { m: '0-0-red' } });
      expect(jest.mocked(harness.transport.send).mock.calls[0][0].kind).toBe('create');
    } finally { engine.dispose(); }
  });

  it('does not recreate a deleted book or send into a different book identity', async () => {
    for (const mismatch of ['deleted', 'different-book']) {
      const { harness, engine, editor } = await offlineBook({ v26_3: { p: '0-1-blue' } });
      try {
        await editor.commit(() => book({ v26_4: { m: '0-0-red' } }));
        if (mismatch === 'deleted') harness.silentRemoteDelete();
        else harness.silentRemote({ book: 'Genesis' });
        engine.setOnline(true); await engine.retry(); await settleEngine();
        expect(editor.getState().result).toMatchObject({ kind: 'refused', code: mismatch === 'deleted' ? 'use-new-copy' : 'invalid-document' });
        expect(harness.transport.send).not.toHaveBeenCalled();
        expect(editor.getState().checkpoint.draft?.verses).toEqual({ v26_4: { m: '0-0-red' } });
      } finally { engine.dispose(); }
    }
  });

  it('merges a remote-only verse added after the fresh read', async () => {
    const { harness, engine, editor } = await offlineBook({ v26_3: { p: '0-1-blue' } });
    const read = jest.mocked(harness.transport.read).getMockImplementation()!;
    jest.mocked(harness.transport.read).mockImplementationOnce(async (...args) => {
      const target = await read(...args);
      harness.silentRemote({ verses: { ...(target.value!.verses as DocumentData), v26_5: { m: '0-0-green' } } });
      return target;
    });
    try {
      await editor.commit(() => book({ v26_4: { m: '0-0-red' } }));
      engine.setOnline(true); await engine.retry(); await settleEngine();
      expect(harness.server.value?.verses).toEqual({ v26_3: { p: '0-1-blue' }, v26_4: { m: '0-0-red' }, v26_5: { m: '0-0-green' } });
    } finally { engine.dispose(); }
  });

  // A verse erased whole is a verse without marks (BUG-20261107-marks-same-verse-offline-conflict): erased there after the read,
  // with a marker added here on its other layer, nothing is in question — the pencil stays erased, the marker stays.
  it('keeps an after-read whole-verse deletion and the new layer drawn here, with no question', async () => {
    const { harness, engine, editor } = await offlineBook({ v26_4: { p: '0-1-blue' } });
    const read = jest.mocked(harness.transport.read).getMockImplementation()!;
    jest.mocked(harness.transport.read).mockImplementationOnce(async (...args) => {
      const target = await read(...args); harness.silentRemote({ verses: {} }); return target;
    });
    try {
      await editor.commit(() => book({ v26_4: { m: '0-0-red' } }));
      engine.setOnline(true); await engine.retry(); await settleEngine();
      expect(editor.getState().result?.kind).toBe('acknowledged');
      expect(harness.server.value?.verses).toEqual({ v26_4: { m: '0-0-red' } });
    } finally { engine.dispose(); }
  });

  it('retires a held fresh target read on account change before any command is prepared', async () => {
    const { harness, engine, editor } = await offlineBook({ v26_3: { p: '0-1-blue' } });
    let release!: (snapshot: ResourceSnapshot) => void;
    jest.mocked(harness.transport.read).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    try {
      await editor.commit(() => book({ v26_4: { m: '0-0-red' } }));
      engine.setOnline(true); await settleEngine();
      expect(harness.transport.read).toHaveBeenCalledTimes(1);
      engine.setOwner('other'); release(stored({ v26_3: { p: '0-1-blue' } }));
      await settleEngine();
      expect(harness.transport.send).not.toHaveBeenCalled();
      expect((await harness.commits.list('owner'))[0].command).toBeNull();
    } finally { engine.dispose(); }
  });

});
