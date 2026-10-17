import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';

import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { EditorController } from '@/data-engine/controller';
import { editorIdentity } from '@/data-engine/editorIdentity';
import { DataEngineProvider, useDocumentActions } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('next/navigation', () => ({ usePathname: () => '/settings' }));
jest.mock('@/data-engine/react.client', () => {
  const actual = jest.requireActual<typeof import('@/data-engine/react.client')>('@/data-engine/react.client');
  return { ...actual, useDocumentActions: () => {
    const current = actual.useDocumentActions();
    return { ...current, resolve: (...args: Parameters<typeof current.resolve>) => {
      mockResolution = current.resolve(...args);
      return mockResolution;
    } };
  } };
});
let mockResolution: Promise<number> | null = null;


let actions: ReturnType<typeof useDocumentActions> | null = null;
function Probe() { const current = useDocumentActions(); useEffect(() => { actions = current; }); return null; }
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const resource = { collection: 'series', id: 'qa-choice' };
const value = { userId: 'owner', title: 'Base title', theme: 'Scope', bookOrTopic: 'James', status: 'active', items: [], sermonIds: [], seriesKind: 'sermon', createdAt: '2026-10-16', updatedAt: '2026-10-16' };

beforeEach(() => { process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'series'; actions = null; mockResolution = null; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

it.each(['document', 'action'].flatMap(slot => ['independent save', 'later typing'].map(arrival => [slot, arrival])))('retains unseen %s %s after the final shown-copy check', async (slot, arrival) => {
  const h = documentEngineHarness({ resource, value, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  jest.mocked(createBrowserDataEngine).mockImplementation(h.createBrowser);
  const view = render(<DataEngineProvider><Probe /><EngineConflictBanner pollMs={50} /></DataEngineProvider>);
  const resume = deferred(), done = deferred(); let entered = false;
  const cancelled = jest.spyOn(h.commits, 'compareAndSet');
  const restore: (() => void)[] = [() => cancelled.mockRestore()];
  try {
    await waitFor(() => expect(actions?.ready).toBe(true));
    const first = await h.engine.openEditor(resource, editorIdentity('test-tab', resource, slot, 'first'));
    const late = await h.engine.openEditor(resource, editorIdentity('test-tab', resource, slot, 'late'));
    await act(async () => {
      await late.edit({ ...value, title: 'Unseen later words' });
      await first.edit({ ...value, title: 'Shown earlier words' });
      h.silentRemote({ title: 'Stored title' }); await first.save(); await settleEngine(); await settleEngine();
      first.close({ flush: false });
    });
    await waitFor(() => expect(screen.getByText(/Shown earlier words/)).toBeInTheDocument());
    expect(screen.queryByText(/Unseen later words/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^(dataSync.acceptRemote|freshness.conflictTakeTheirs)$/ }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    if (slot === 'document') {
      const take = h.engine.takeStoredVersion.bind(h.engine), read = h.commits.list.bind(h.commits);
      const spy = jest.spyOn(h.engine, 'takeStoredVersion').mockImplementation(async (...args) => {
        const held = jest.spyOn(h.commits, 'list').mockImplementationOnce(async owner => { entered = true; await resume.promise; return read(owner); });
        try { return await take(...args); } finally { held.mockRestore(); done.resolve(); }
      });
      restore.push(() => spy.mockRestore());
    } else {
      const read = h.engine.listRecoverable.bind(h.engine);
      const spy = jest.spyOn(h.engine, 'listRecoverable').mockImplementation(async ref => {
        if (ref?.collection === resource.collection && ref.id === resource.id && !entered) {
          entered = true; await resume.promise;
        }
        return read(ref);
      });
      restore.push(() => spy.mockRestore());
    }
    fireEvent.click(screen.getByRole('button', { name: 'common.discardText.confirm' }));
    await waitFor(() => expect(entered).toBe(true));
    await act(async () => {
      if (arrival === 'independent save') {
        await late.save(); await settleEngine(); await h.engine.retry(); await settleEngine();
      } else {
        const reopened = await h.engine.openEditor(resource, editorIdentity('test-tab', resource, slot, 'first'));
        await reopened.edit({ ...reopened.getState().checkpoint.draft, title: 'Unseen later words' });
        reopened.close({ flush: false });
      }
      late.close({ flush: false });
    });
    const requests = await h.commits.list('owner');
    expect(requests).toHaveLength(arrival === 'independent save' ? 2 : 1);
    expect(requests.every(request => request.predecessor === null && request.state === 'conflict')).toBe(true);
    await act(async () => { resume.resolve(); if (slot === 'document') await done.promise; else await mockResolution; await settleEngine(); await settleEngine(); });
    const remaining = (await h.engine.listRecoverable(resource)).map(({ record }) => record.checkpoint.draft?.title);
    expect(remaining).toContain('Unseen later words');
    expect(remaining).not.toContain('Shown earlier words');
    const settled = await h.commits.list('owner');
    expect(cancelled.mock.calls.some(([, next]) => next.id === requests[0].id && next.state === 'cancelled' && next.cancelledByChoice)).toBe(true);
    if (arrival === 'independent save') {
      const unseen = settled.find(request => request.id === requests[1].id);
      expect(unseen).toMatchObject({ state: 'conflict' });
      expect(unseen?.cancelledByChoice).not.toBe(true);
    }
  } finally { resume.resolve(); restore.forEach(stop => stop()); view.unmount(); }
});


it.each(['mine', 'theirs'] as const)('keeps legacy direct-command recovery working for %s through the scoped global notice', async choice => {
  const snapshot = { resource, value, metadata: { protocol: 1 as const, generation: 'g1', revision: 1, deleted: false } };
  const h = documentEngineHarness(snapshot);
  jest.mocked(createBrowserDataEngine).mockImplementation(h.createBrowser);
  const view = render(<DataEngineProvider><Probe /><EngineConflictBanner pollMs={50} /></DataEngineProvider>);
  try {
    await waitFor(() => expect(actions?.ready).toBe(true));
    const editor = await EditorController.open({ owner: 'owner', editorId: editorIdentity('old-tab', resource, 'action', 'legacy'),
      snapshot, store: h.checkpoints, runtime: h.runtime, operationId: () => 'legacy-choice', isCurrentOwner: owner => owner === 'owner' });
    await act(async () => {
      await editor.edit({ ...value, title: 'Legacy shown words' });
      h.silentRemote({ title: 'Stored title' });
      await editor.save(); await h.runtime.drain(); await editor.settled(); editor.dispose(); await settleEngine();
    });
    expect(await h.commits.list('owner')).toHaveLength(0);
    await waitFor(() => expect(screen.getByText(/Legacy shown words/)).toBeInTheDocument());
    if (choice === 'mine') {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'freshness.conflictKeepMine' })); await settleEngine(); });
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'freshness.conflictTakeTheirs' }));
      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common.discardText.confirm' })); await settleEngine(); });
    }
    expect(mockResolution).not.toBeNull();
    await act(async () => { await mockResolution; await settleEngine(); await settleEngine(); });
    await waitFor(() => expect(screen.queryByText(/Legacy shown words/)).not.toBeInTheDocument());
    expect(await h.engine.listRecoverable(resource)).toHaveLength(0);
    expect(await h.engine.listPending()).toHaveLength(0);
    expect(h.server.value?.title).toBe(choice === 'mine' ? 'Legacy shown words' : 'Stored title');
  } finally { view.unmount(); }
});

it.each(['empty', 'unknown', 'another resource'] as const)('does not broaden a %s request selection', async selection => {
  const h = documentEngineHarness({ resource, value, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  const browser = h.createBrowser(); browser.engine.setOwner('owner');
  try {
    const editor = await h.engine.openEditor(resource, editorIdentity('test-tab', resource, 'document', 'boundary'));
    await editor.edit({ ...value, title: 'Retained words' }); h.silentRemote({ title: 'Stored title' });
    await editor.save(); await settleEngine(); await settleEngine(); editor.close({ flush: false });
    const [request] = await h.commits.list('owner'); expect(request.state).toBe('conflict');
    const ids = selection === 'empty' ? [] : selection === 'unknown' ? ['unseen-operation'] : [request.id];
    expect(await h.engine.takeStoredVersion(selection === 'another resource' ? { ...resource, id: 'other-series' } : resource, ids)).toBe(0);
    expect((await h.engine.listRecoverable(resource)).map(({ record }) => record.checkpoint.draft?.title)).toContain('Retained words');
    expect((await h.commits.list('owner'))[0].state).toBe('conflict');
  } finally { browser.dispose(); }
});


it.each(['unknown legacy', 'missing modern'] as const)('retains undecidable %s work behind the strict queue/runtime guard', async scenario => {
  const snapshot = { resource, value, metadata: { protocol: 1 as const, generation: 'g1', revision: 1, deleted: false } };
  const h = documentEngineHarness(snapshot); const browser = h.createBrowser(); browser.engine.setOwner('owner');
  let restore = () => undefined;
  try {
    const editorId = editorIdentity('guard-tab', resource, 'action', 'guard');
    if (scenario === 'unknown legacy') {
      jest.mocked(h.transport.send).mockRejectedValue(new TypeError('Lost delivery result'));
      const old = await EditorController.open({ owner: 'owner', editorId, snapshot, store: h.checkpoints, runtime: h.runtime,
        operationId: () => 'unknown-legacy', isCurrentOwner: owner => owner === 'owner' });
      await old.edit({ ...value, title: 'Undecidable words' }); await old.save(); await h.runtime.drain(); await old.settled(); old.dispose();
      expect((await h.runtime.list())[0].state).toBe('unknown');
    } else {
      const first = await h.engine.openEditor(resource, editorId);
      await first.edit({ ...value, title: 'Undecidable words' }); h.silentRemote({ title: 'Stored title' });
      await first.save(); await settleEngine(); await settleEngine(); first.close({ flush: false });
    }
    const [{ record }] = await h.engine.listRecoverable(resource);
    const editor = await h.engine.openEditor(resource, editorId);
    if (scenario === 'missing modern') {
      expect(editor.getState().preparedOperationId).toBeUndefined();
      const read = jest.spyOn(h.commits, 'list').mockResolvedValue([]); restore = () => { read.mockRestore(); return undefined; };
    }
    if (scenario === 'unknown legacy') await expect(editor.acceptRemote(record)).rejects.toThrow('Cannot discard an unresolved command');
    else await expect(editor.acceptRemote(record)).rejects.toMatchObject({ code: 'pending-delivery-first' });
    expect(editor.getState().checkpoint.draft?.title).toBe('Undecidable words');
    expect(Object.keys(editor.getState().checkpoint.pending)).toHaveLength(1);
    editor.close({ flush: false });
  } finally { restore(); browser.dispose(); }
});
