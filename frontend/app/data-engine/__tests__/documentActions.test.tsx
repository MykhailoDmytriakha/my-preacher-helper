import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { captureRecoveryChoice, DataEngineProvider, useDocumentActions, useStoredVersionTaken } from '@/data-engine/react.client';
import { prepareNoteDraftCapture } from '@/utils/draftCaptureRecovery.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import { collectionDocumentViews } from '../collectionView';
import { applyCommand } from '../protocol';

import type { DocumentData, ResourceSnapshot } from '../types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'sermons', id: 'sermon-1' };
const stored = { userId: 'owner', title: 'Grace', verse: 'John 1:14', date: '2026-09-01', thoughts: [], sourceNoteIds: ['note-a'] };

const savedSermon: ResourceSnapshot = { resource, value: stored, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } };

function setup(snapshot = savedSermon, options?: Parameters<typeof documentEngineHarness>[1]) {
  const harness = documentEngineHarness(snapshot, options);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const wrapper = ({ children }: { children: React.ReactNode }) => <DataEngineProvider>{children}</DataEngineProvider>;
  const notified = jest.fn();
  return { harness, notified, ...renderHook(() => {
    const actions = useDocumentActions();
    const subscribeVersionTaken = useStoredVersionTaken();
    React.useEffect(() => subscribeVersionTaken(resource, notified), [subscribeVersionTaken]);
    return { ...actions, subscribeVersionTaken };
  }, { wrapper }) };
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

  const creations: { collection: string; value: DocumentData }[] = [
    { collection: 'prayerRequests', value: { title: 'Prayer for a neighbor', status: 'active', updates: [] } },
    { collection: 'tags', value: { name: 'Patience', color: '#000000', required: false } },
    { collection: 'planTemplates', value: { name: 'Reusable outline', structure: { introduction: [], main: [], conclusion: [] } } },
    { collection: 'groups', value: { title: 'Group', status: 'draft', templates: [], flow: [], meetingDates: [] } },
    { collection: 'councils', value: { title: 'Council', status: 'preparing', topics: [] } },
    { collection: 'series', value: { title: 'Series', theme: 'Series', bookOrTopic: 'Topic', status: 'draft', sermonIds: [] } },
    { collection: 'sermons', value: { title: 'Sermon', verse: 'John 1:14', date: '2026-11-12', thoughts: [] } },
    { collection: 'studyNotes', value: { title: 'Note', content: 'Words', type: 'note', scriptureRefs: [], tags: [], isDraft: false } },
  ];
  it.each(creations)('deletes the exact pending first creation in $collection after reconnect', async ({ collection, value }) => {
    const target = { collection, id: 'new-document' };
    const { harness, result, unmount } = setup({ resource: target, value: null, metadata: null });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { harness.engine.setOnline(false); });
    const timestamp = '2026-11-12T20:00:00.000Z';
    try {
      await act(async () => {
        await result.current.create(target, { ...value, userId: 'owner', createdAt: timestamp, updatedAt: timestamp });
        if (collection === 'studyNotes') {
          await expect(result.current.submit(target, { kind: 'delete' })).resolves.toMatchObject({ kind: 'submitted' });
        } else {
          await expect(result.current.remove(target)).resolves.toBeUndefined();
        }
      });
      expect(harness.transport.send).not.toHaveBeenCalled();
      const queued = await harness.commits.list('owner');
      const creation = queued.find(item => item.value !== null);
      expect(creation).toBeDefined();
      expect(queued.find(item => item.value === null)).toMatchObject({ predecessor: creation?.id });
      await act(async () => { harness.engine.setOnline(true); await harness.engine.retry(); await settleEngine(); });
      const sent = jest.mocked(harness.transport.send).mock.calls.map(([command]) => command);
      expect(sent.map(command => [command.kind, command.resource.id])).toEqual([['create', target.id], ['delete', target.id]]);
      expect(sent[1].generation).toBe(sent[0].operationId);
      expect(harness.server).toMatchObject({ resource: target, value: null, metadata: { deleted: true } });
    } finally { unmount(); }
  });

  it.each(creations.filter(item => item.collection !== 'prayerRequests'))(
    'removes a new $collection after separately saving an edit',
    async ({ collection, value }) => {
      const target = { collection, id: 'create-edit-delete' };
      const { harness, result, unmount } = setup({ resource: target, value: null, metadata: null });
      await waitFor(() => expect(result.current.ready).toBe(true));
      await act(async () => { harness.engine.setOnline(false); });
      const time = '2026-11-12T20:00:00.000Z';
      const edit: DocumentData = collection === 'tags' ? { color: '#2563eb' }
        : collection === 'planTemplates' ? { name: 'Updated template' } : { title: 'Updated title' };
      try {
        await act(async () => {
          await result.current.create(target, { ...value, userId: 'owner', createdAt: time, updatedAt: time });
          await result.current.commit(target, current => ({ ...current!, ...edit }));
          if (collection === 'studyNotes') await result.current.submit(target, { kind: 'delete' });
          else await result.current.remove(target);
        });
        expect(harness.transport.send).not.toHaveBeenCalled();
        await act(async () => { harness.engine.setOnline(true); await harness.engine.retry(); await settleEngine(); });
        const commands = jest.mocked(harness.transport.send).mock.calls.map(([command]) => command);
        expect(commands.map(command => command.kind)).toEqual(['create', 'update', 'delete']);
        expect(commands[2].generation).toBe(commands[0].operationId);
        expect(harness.server).toMatchObject({ resource: target, value: null, metadata: { deleted: true } });
      } finally { unmount(); }
    },
  );

  it.each([false, true])('omits the exact deleted creation from recovery and keeps private words (edited: %s)', async edited => {
    const target = { collection: 'groups', id: 'new-group' };
    const { harness, result, unmount } = setup({ resource: target, value: null, metadata: null });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { harness.engine.setOnline(false); });
    const group = { userId: 'owner', title: 'New group', status: 'draft', templates: [], flow: [], meetingDates: [] };
    try {
      await act(async () => { await result.current.create(target, group); });
      const [groupChoice] = await harness.engine.listRecoveryChoices(target);
      expect(groupChoice?.record.checkpoint.draft?.title).toBe('New group');
      if (edited) await act(async () => {
        await result.current.commit(target, current => ({ ...current!, title: 'Saved group title' }));
      });
      const copy = await harness.engine.openEditor(target, 'private-group');
      await copy.edit({ ...group, title: 'Independent unsaved words' });
      await copy.close({ flush: false });
      await settleEngine();
      await act(async () => { await result.current.remove(target); });
      const titles = (await harness.engine.listRecoveryChoices(target)).map(entry => entry.record.checkpoint.draft?.title);
      expect(titles).not.toContain('New group');
      expect(titles).not.toContain('Saved group title');
      expect(titles).toContain('Independent unsaved words');
    } finally { unmount(); }
  });

  it.each(['new', 'stored', 'legacy'] as const)('honors Delete after the shown pending edit and restart (%s)', async kind => {
    const alreadyStored = kind !== 'new';
    const target = { collection: 'prayerRequests', id: 'prayer-with-an-edit' };
    const timestamp = '2026-11-12T20:00:00.000Z';
    const prayer = { userId: 'owner', title: 'Prayer', status: 'active', updates: [], createdAt: timestamp, updatedAt: timestamp };
    const baseline: ResourceSnapshot = alreadyStored
      ? { resource: target, value: prayer, metadata: kind === 'legacy' ? null : { protocol: 1, generation: 'original', revision: 1, deleted: false } }
      : { resource: target, value: null, metadata: null };
    const { harness, result, unmount } = setup(baseline);
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { harness.engine.setOnline(false); });
    try {
      await act(async () => {
        if (!alreadyStored) await result.current.create(target, prayer);
        await result.current.commit(target, current => ({ ...current!, description: 'Saved just before Delete' }));
        await expect(result.current.remove(target)).resolves.toBeUndefined();
      });
      expect(harness.transport.send).not.toHaveBeenCalled();
      const saved = await harness.commits.list('owner');
      const deletion = saved.find(request => request.value === null);
      expect(deletion?.predecessor).toBe(saved.find(request => request.value?.description === 'Saved just before Delete')?.id);
    } finally { unmount(); }

    const reopened = harness.createBrowser();
    reopened.engine.setOnline(false);
    reopened.engine.setOwner('owner');
    try {
      const document = await reopened.engine.openEditor(target, reopened.editorId(target, 'detail'));
      expect(document.getState().checkpoint.draft).toBeNull();
      await document.close({ flush: false });
      reopened.engine.setOnline(true);
      await reopened.engine.retry();
      await settleEngine();
      const sent = jest.mocked(harness.transport.send).mock.calls.map(([command]) => command);
      expect(sent.map(command => command.kind)).toEqual(alreadyStored ? ['update', 'delete'] : ['create', 'update', 'delete']);
      expect(sent.at(-1)?.generation).toBe(baseline.metadata?.generation ?? sent[0].operationId);
      expect(harness.server).toMatchObject({ resource: target, value: null, metadata: { deleted: true } });
    } finally { reopened.dispose(); }
  });

  it.each(['unseen edit', 'refused ancestor'] as const)('preserves the record when pending Delete meets a %s', async problem => {
    const target = { collection: 'prayerRequests', id: 'existing-prayer' };
    const timestamp = '2026-11-12T20:00:00.000Z';
    const value = { userId: 'owner', title: 'Prayer', status: 'active', updates: [], createdAt: timestamp, updatedAt: timestamp };
    const { harness, result, unmount } = setup({ resource: target, value,
      metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false } }, {
      apply: (command, current) => problem === 'refused ancestor' && command.kind === 'update'
        ? { kind: 'refused', operationId: command.operationId, code: 'permission-denied' } : applyCommand(command, current),
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { harness.engine.setOnline(false); });
    try {
      await act(async () => {
        await result.current.commit(target, current => ({ ...current!, description: 'Shown edit' }));
        if (problem === 'refused ancestor') await result.current.commit(target, current => ({ ...current!, description: 'Second shown edit' }));
        await result.current.remove(target);
      });
      if (problem === 'unseen edit') harness.silentRemote({ title: 'From the other device' });
      await act(async () => { harness.engine.setOnline(true); await harness.engine.retry(); await settleEngine(); });
      expect(jest.mocked(harness.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['update']);
      expect(harness.server.metadata?.deleted).toBe(false);
      if (problem === 'unseen edit') expect(harness.server.value).toMatchObject({ title: 'From the other device', description: 'Shown edit' });
      const records = await harness.commits.list('owner');
      const deletion = records.find(request => request.value === null);
      expect(deletion?.state).toBe(problem === 'unseen edit' ? 'conflict' : 'refused');
      expect(collectionDocumentViews('owner', target.collection, [harness.server], records)[0])
        .toMatchObject({ value: harness.server.value, deleting: false, needsAttention: true });
    } finally { unmount(); }
  });

  it('keeps the visible saved edit when it cannot capture Delete on this device', async () => {
    const target = { collection: 'prayerRequests', id: 'delete-storage-failure' };
    const value = { userId: 'owner', title: 'Prayer', status: 'active', updates: [] };
    const { harness, result, unmount } = setup({ resource: target, value,
      metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { harness.engine.setOnline(false); });
    try {
      await act(async () => { await result.current.commit(target, current => ({ ...current!, description: 'Visible words' })); });
      const opened = await harness.engine.openEditor(target, 'before-remove');
      harness.storage.writeFailure = true;
      await expect(opened.remove()).rejects.toThrow('disk full');
      harness.storage.writeFailure = false;
      expect(opened.getState().checkpoint.draft?.description).toBe('Visible words');
      expect((await harness.commits.list('owner')).map(request => request.value?.description)).toEqual(['Visible words']);
    } finally { harness.storage.writeFailure = false; unmount(); }
  });

  it('keeps later typing in its own saved generation while the earlier Delete is writing', async () => {
    const target = { collection: 'prayerRequests', id: 'typing-during-delete' };
    const value = { userId: 'owner', title: 'Prayer', status: 'active', updates: [] };
    const { harness, result, unmount } = setup({ resource: target, value,
      metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { harness.engine.setOnline(false); });
    let start!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { start = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const create = harness.commits.createWithCheckpoint!;
    const storage = jest.spyOn(harness.commits, 'createWithCheckpoint').mockImplementation(async (request, project) => {
      if (request.value === null) { start(); await held; }
      return create(request, project);
    });
    try {
      await act(async () => { await result.current.commit(target, current => ({ ...current!, description: 'Saved opening' })); });
      const editor = await harness.engine.openEditor(target, 'typing-during-delete');
      const removal = editor.remove();
      await started;
      const editing = editor.edit({ ...value, description: 'Typed later' });
      const saving = editor.save();
      const completion = Promise.all([removal, editing, saving]);
      release();
      await completion;
      const records = await harness.commits.list('owner');
      const deleted = records.find(request => request.value === null);
      const latest = records.find(request => request.value?.description === 'Typed later');
      expect(latest?.predecessor).toBe(deleted?.id);
      expect(latest!.editGeneration).toBeGreaterThan(deleted!.editGeneration);
      expect(editor.getState().checkpoint.draft?.description).toBe('Typed later');
      await editor.close({ flush: false });
    } finally { release(); storage.mockRestore(); unmount(); }

    const restarted = harness.createBrowser();
    restarted.engine.setOnline(false);
    restarted.engine.setOwner('owner');
    try {
      const editor = await restarted.engine.openEditor(target, 'after-typing-during-delete');
      expect(editor.getState().checkpoint.draft?.description).toBe('Typed later');
    } finally { restarted.dispose(); }
  });

  it.each(['update', 'delete'] as const)('retains the exact public %s capture until its caller releases it', async kind => {
    const { harness, result, unmount } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    harness.engine.setOnline(false);
    try {
      const scope = `public-capture:${kind}`;
      const action = kind === 'delete' ? { kind } : { kind, update: (current: typeof stored | null) => ({ ...current!, title: 'Captured words' }) };
      const receipt = await result.current.submit(resource, action as Parameters<typeof result.current.submit>[1], { captureScope: scope });
      const request = (await harness.commits.list('owner')).find(row => row.id === receipt.requestId);
      expect(request?.retentionScope).toBe(scope);
      expect((await harness.engine.listWriteCaptures('public-capture:')).map(row => row.requestId)).toEqual([receipt.requestId]);
      await harness.engine.releaseWriteCapture(scope, receipt.requestId!);
      expect(await harness.engine.listWriteCaptures('public-capture:')).toEqual([]);
      expect((await harness.commits.list('owner')).some(row => row.id === receipt.requestId)).toBe(true);
    } finally { unmount(); }
  });

  it('sends a shortened note from the same editor after its content request was refused for size', async () => {
    const target = { collection: 'studyNotes', id: 'size-refused-note' };
    const opening = { userId: 'owner', title: 'Note', content: 'Original text', type: 'note',
      scriptureRefs: [], tags: [], isDraft: true, createdAt: '2026-11-14', updatedAt: '2026-11-14' };
    const initial: ResourceSnapshot = { resource: target, value: opening,
      metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } };
    const { harness, result } = setup(initial, {
      apply: (command, current) => command.kind === 'update' && command.changes.some(change => change.after.value === 'Very large refused text')
        ? { kind: 'refused', operationId: command.operationId, code: 'resource-exhausted' }
        : applyCommand(command, current),
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    const save = (content: string, writer = 'note-writer', previous = opening.content) => result.current.submit(target,
      { kind: 'update', update: (current, _confirmed, sizeRefusedDraft) => {
        if (current?.content !== previous && sizeRefusedDraft?.content !== previous) throw new Error('Opening changed');
        return { ...current!, content };
      } }, {
        captureScope: prepareNoteDraftCapture('owner', target.id, { ...opening, content }, writer),
        noteContent: { generation: 'g1', observedRevision: 1, opening: opening.content, time: null },
      });
    const refused = await save('Very large refused text');
    await expect(refused.persistence).rejects.toMatchObject({ code: 'resource-exhausted' });
    const original = jest.mocked(harness.transport.send).mock.calls[0][0];
    const failed = (await harness.commits.list('owner')).find(request => request.id === refused.requestId)!;
    await expect(save('Words in a different draft', 'different-writer')).rejects.toMatchObject({ code: 'decision-required' });
    await expect(save('Very large refused text', 'note-writer', 'Very large refused text')).rejects.toMatchObject({ code: 'decision-required' });
    harness.storage.writeFailureFor = (key, value) => Array.isArray(key) && key[0] === 'checkpoint' && value !== undefined;
    try {
      await expect(save('Short text', 'note-writer', 'Very large refused text')).rejects.toThrow('disk full');
      expect((await harness.commits.list('owner')).find(request => request.id === refused.requestId)).toEqual(failed);
      expect(harness.transport.send).toHaveBeenCalledTimes(1);
    } finally {
      harness.storage.writeFailureFor = undefined;
    }
    const corrected = await save('Short text', 'note-writer', 'Very large refused text');
    expect(corrected.requestId).not.toBe(refused.requestId);
    await expect(corrected.persistence).resolves.toMatchObject({ value: { content: 'Short text' }, metadata: { revision: 2 } });
    const sent = jest.mocked(harness.transport.send).mock.calls.map(([command]) => command);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(original);
    expect(sent[1]).toMatchObject({ kind: 'update', generation: 'g1', studyNoteContentAction: { observedRevision: 1, time: null }, changes: [{
      path: ['content'], before: { exists: true, value: 'Original text' }, after: { exists: true, value: 'Short text' },
    }] });
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

    it('takes a service rename started while the user’s earlier choice is being applied', async () => {
      const service = { collection: 'serviceOrders', id: 'service-1' };
      const snapshot: ResourceSnapshot = { ...savedSermon, resource: service,
        value: { userId: 'owner', title: 'Service name', rank: 1000, steps: [] } };
      const harness = documentEngineHarness(snapshot);
      jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
      const wrapper = ({ children }: { children: React.ReactNode }) => <DataEngineProvider>{children}</DataEngineProvider>;
      const { result } = renderHook(() => ({ banner: useDocumentActions(), form: useDocumentActions() }), { wrapper });
      await waitFor(() => expect(result.current.form.ready).toBe(true));
      harness.silentRemote({ title: 'Edited on the laptop' });
      await act(async () => { await result.current.form.commit(service, current => ({ ...current!, title: 'Edited on the phone' })); });
      await waitFor(async () => { await settleEngine(); expect(await harness.engine.listRecoverable(service)).toHaveLength(1); });
      const earlierReads = harness.engine.listRecoverable.bind(harness.engine);
      let release!: () => void;
      const readGate = new Promise<void>(resolve => { release = resolve; });
      const delayed = jest.spyOn(harness.engine, 'listRecoverable').mockImplementationOnce(async target => {
        await readGate;
        return earlierReads(target);
      });
      const choice = result.current.banner.resolve(service, 'mine');
      const rename = result.current.form.submit(service, { kind: 'update', update: current => ({ ...current!, title: 'Newest words' }) });
      const outcome = rename.then(() => 'submitted', error => (error as { code?: string }).code);
      try {
        await act(async () => { await settleEngine(); release(); await choice; });
        expect(await outcome).toBe('submitted');
        await waitFor(async () => { await settleEngine(); expect(harness.server.value?.title).toBe('Newest words'); });
      } finally { release(); delayed.mockRestore(); }
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


describe('stored version taken announcements', () => {
  it.each(['mine', 'theirs'] as const)('announces only the stored-version choice on an empty %s return', async choice => {
    const { result, notified } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { expect(await result.current.resolve(resource, choice)).toBe(0); });
    expect(notified).toHaveBeenCalledTimes(Number(choice === 'theirs'));
  });

  it.each([
    { choice: 'mine' as const, scoped: false }, { choice: 'theirs' as const, scoped: false },
    { choice: 'mine' as const, scoped: true }, { choice: 'theirs' as const, scoped: true },
    { choice: 'theirs' as const, scoped: true, exactField: true },
  ])('announces only after theirs completes: $choice (scoped=$scoped, exactField=$exactField)', async ({ choice, scoped, exactField }) => {
    const { harness, result, notified } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    harness.silentRemote({ title: 'Phone' });
    await act(async () => { await result.current.commit(resource, current => ({ ...current!, title: 'Laptop' })); });
    await waitFor(async () => { await settleEngine(); expect(await harness.engine.listRecoverable(resource)).toHaveLength(1); });
    const records = (await harness.engine.listRecoverable(resource)).map(item => item.record);
    const scope = scoped ? captureRecoveryChoice(records) : undefined;
    expect(notified).not.toHaveBeenCalled();
    await act(async () => { expect(await result.current.resolve(resource, choice, scope, exactField)).toBe(1); });
    expect(notified).toHaveBeenCalledTimes(Number(choice === 'theirs'));
    await settleEngine();
    expect(harness.server.value?.title).toBe(choice === 'mine' ? 'Laptop' : 'Phone');
  });

  it('does not announce a validation failure or a thrown replacement save', async () => {
    const { harness, result, notified } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await expect(result.current.resolve(resource, 'theirs', undefined, true)).rejects.toMatchObject({ code: 'decision-changed' });
    expect(notified).not.toHaveBeenCalled();
    harness.silentRemote({ title: 'Phone' });
    await act(async () => { await result.current.commit(resource, current => ({ ...current!, title: 'Laptop' })); });
    await waitFor(async () => { await settleEngine(); expect(await harness.engine.listRecoverable(resource)).toHaveLength(1); });
    const open = harness.engine.openEditor.bind(harness.engine);
    jest.spyOn(harness.engine, 'openEditor').mockImplementation(async (...args) => {
      const editor = await open(...args);
      editor.save = async () => { throw new Error('Replacement capture failed'); };
      return editor;
    });
    await act(async () => { await expect(result.current.resolve(resource, 'mine')).rejects.toThrow('Replacement capture failed'); });
    expect(notified).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not announce when taking the stored version throws (exactField=%s)', async exactField => {
    const { harness, result, notified } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    harness.silentRemote({ title: 'Phone' });
    await act(async () => { await result.current.commit(resource, current => ({ ...current!, title: 'Laptop' })); });
    await waitFor(async () => { await settleEngine(); expect(await harness.engine.listRecoverable(resource)).toHaveLength(1); });
    const scope = captureRecoveryChoice((await harness.engine.listRecoverable(resource)).map(item => item.record));
    const open = harness.engine.openEditor.bind(harness.engine);
    const spy = exactField
      ? jest.spyOn(harness.engine, 'openEditor').mockImplementation(async (...args) => {
        const editor = await open(...args);
        editor.acceptRemote = async () => { throw new Error('Take failed'); };
        return editor;
      })
      : jest.spyOn(harness.engine, 'takeStoredVersion').mockRejectedValue(new Error('Take failed'));
    try {
      await act(async () => { await expect(result.current.resolve(resource, 'theirs', scope, exactField)).rejects.toThrow('Take failed'); });
      expect(notified).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('keeps a successful resolve and later observers when an observer throws', async () => {
    const { result, notified } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    const error = new Error('Observer failed');
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const stopThrowing = result.current.subscribeVersionTaken(resource, () => { throw error; });
    const later = jest.fn();
    const stopLater = result.current.subscribeVersionTaken(resource, later);
    try {
      await act(async () => { await expect(result.current.resolve(resource, 'theirs')).resolves.toBe(0); });
      expect(notified).toHaveBeenCalledTimes(1);
      expect(later).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledWith('DataEngine background operation failed', error);
    } finally { stopThrowing(); stopLater(); logged.mockRestore(); }
  });

  it('announces to a snapshot despite subscriptions changing during notification', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    const late = jest.fn(), removed = jest.fn();
    let stopLate = () => {};
    let stopRemoved = () => {};
    const stopChanging = result.current.subscribeVersionTaken(resource, () => {
      stopRemoved();
      stopLate = result.current.subscribeVersionTaken(resource, late);
    });
    stopRemoved = result.current.subscribeVersionTaken(resource, removed);
    try {
      await act(async () => { await result.current.resolve(resource, 'theirs'); });
      expect(removed).toHaveBeenCalledTimes(1);
      expect(late).not.toHaveBeenCalled();
    } finally { stopChanging(); stopRemoved(); stopLate(); }
  });

  it('filters collection and id, unsubscribes, and does not replay an earlier completion', async () => {
    const { result, notified } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    const wrongCollection = jest.fn(), wrongId = jest.fn(), stopped = jest.fn(), late = jest.fn();
    const stops = [
      result.current.subscribeVersionTaken({ ...resource, collection: 'studyNotes' }, wrongCollection),
      result.current.subscribeVersionTaken({ ...resource, id: 'other' }, wrongId),
    ];
    result.current.subscribeVersionTaken(resource, stopped)();
    await act(async () => { await result.current.resolve(resource, 'theirs'); });
    const stopLate = result.current.subscribeVersionTaken(resource, late);
    expect(notified).toHaveBeenCalledTimes(1);
    expect(wrongCollection).not.toHaveBeenCalled();
    expect(wrongId).not.toHaveBeenCalled();
    expect(stopped).not.toHaveBeenCalled();
    expect(late).not.toHaveBeenCalled();
    stopLate(); stops.forEach(stop => stop());
  });
});
