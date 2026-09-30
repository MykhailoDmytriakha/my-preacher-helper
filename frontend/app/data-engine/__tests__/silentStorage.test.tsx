import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { useAuth } from '@/providers/AuthProvider';
import { STORAGE_SILENCE_MS, STORAGE_WAKE_GRACE_MS, resetDeviceStorageForTests, trackStorage } from '@/utils/deviceStorage';

import { createBrowserDataEngine, type BrowserDataEngine } from '../browser.client';
import { DataDocumentProvider, DataEngineProvider, useDataCollection, useDataDocument, useDataForm, useDocumentActions } from '../react.client';

import type { CollectionState } from '../collections';
import type { EditorState } from '../controller';
import type { ManagedEditor } from '../engine';
import type { Observation } from '../observer';
import type { ResourceRef, ResourceSnapshot } from '../types';

/*
 * DEVICE STORAGE THAT NEVER ANSWERS (BUG-20260927-engine-open-hangs-on-silent-device-storage).
 *
 * On the owner's iPad (Safari 26.6.1) an IndexedDB transaction was left hanging, and every later
 * one queued behind it — across reloads — for half an hour. The council screen waited on it with
 * no deadline and showed a skeleton at the very meeting it was prepared for. These tests hold the
 * contract the person needs: what can be read is shown within seconds, nothing can be typed into
 * a copy that cannot be saved, and editing comes back by itself when storage answers again.
 */

jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../browser.client', () => ({ createBrowserDataEngine: jest.fn() }));

const resource = { collection: 'councils', id: 'council-1' };
const snapshot = (title: string, revision = 1): ResourceSnapshot => ({
  resource, value: { userId: 'owner', title }, metadata: { protocol: 1, generation: 'g', revision, deleted: false },
});
const never = <T,>() => new Promise<T>(() => undefined);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const Wrapper = ({ children }: { children: React.ReactNode }) => <DataEngineProvider>{children}</DataEngineProvider>;

function makeEditor(title: string): ManagedEditor {
  const state: EditorState = { durable: true, error: null, result: null, checkpoint: {
    confirmed: snapshot(title), draft: { userId: 'owner', title }, dirty: false, editGeneration: 0, pending: {}, conflicts: [], remoteCandidate: null,
  } };
  const observation: Observation = { snapshot: snapshot(title), source: 'server', readiness: 'server', checking: false, error: false };
  return {
    form: jest.fn(), getState: jest.fn(() => state), getObservation: jest.fn(() => observation), getDelivery: jest.fn(() => []),
    subscribe: jest.fn(() => () => undefined), edit: jest.fn(async () => undefined), commit: jest.fn(async () => undefined),
    save: jest.fn(async () => undefined), acceptRemote: jest.fn(async () => undefined), keepLocal: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined), dispose: jest.fn(), close: jest.fn(),
  };
}

function makeBrowser() {
  const engine = {
    setOwner: jest.fn(),
    openEditor: jest.fn<Promise<ManagedEditor>, [ResourceRef, string, { signal?: AbortSignal }?]>(() => never()),
    createEditor: jest.fn<Promise<ManagedEditor>, [ResourceRef, string, { signal?: AbortSignal }?]>(() => never()),
    recoverEditor: jest.fn(() => never()),
    retry: jest.fn(async () => undefined),
    listRecoverable: jest.fn(() => never()),
    listPending: jest.fn(() => never()),
    peekCached: jest.fn<Promise<ResourceSnapshot | undefined>, [ResourceRef]>(() => never()),
    peekRemote: jest.fn<Promise<ResourceSnapshot>, [ResourceRef]>(() => never()),
    watchCollection: jest.fn(() => () => undefined),
    refreshCollection: jest.fn(() => never()),
    peekCollectionCached: jest.fn<Promise<CollectionState>, [string]>(() => never()),
    peekCollectionRemote: jest.fn<Promise<CollectionState>, [string]>(() => never()),
  };
  const browser: BrowserDataEngine = {
    engine: engine as unknown as BrowserDataEngine['engine'], dispose: jest.fn(),
    editorId: jest.fn((ref: ResourceRef, slot?: string) => JSON.stringify([ref.collection, ref.id, slot])),
  };
  jest.mocked(createBrowserDataEngine).mockReturnValue(browser);
  return engine;
}

const SILENT = STORAGE_SILENCE_MS + STORAGE_WAKE_GRACE_MS;
const passSilence = () => act(async () => { await jest.advanceTimersByTimeAsync(SILENT + 10); });
/** The call the opening is stuck on: engine records that never answer. */
const storageGoesSilent = (database = 'engine-state') => { void trackStorage(database, never()); };
const copyScreen = { readOnlyCopy: true };

describe('screens keep working while device storage does not answer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resetDeviceStorageForTests();
    jest.mocked(useAuth).mockReturnValue({ user: { uid: 'owner' }, loading: false, isAuthenticated: true } as ReturnType<typeof useAuth>);
  });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  describe('one document', () => {
    it('shows the server copy for reading when the storage the editor opens from is silent', async () => {
      const engine = makeBrowser();
      engine.peekRemote.mockResolvedValue(snapshot('Bible Truck', 3));
      const hook = renderHook(() => useDataDocument(resource, copyScreen), { wrapper: Wrapper });
      await waitFor(() => expect(engine.openEditor).toHaveBeenCalled());
      storageGoesSilent();
      expect(hook.result.current.loading).toBe(true);

      await passSilence();

      await waitFor(() => expect(hook.result.current.data).toEqual({ userId: 'owner', title: 'Bible Truck' }));
      expect(hook.result.current.loading).toBe(false);
      expect(hook.result.current.readOnly).toBe(true);
      expect(hook.result.current.copySource).toBe('server');
    });

    it('shows the copy this device kept when there is no network', async () => {
      const engine = makeBrowser();
      engine.peekCached.mockResolvedValue(snapshot('Seen before', 2));
      engine.peekRemote.mockRejectedValue(new Error('offline'));
      const hook = renderHook(() => useDataDocument(resource, copyScreen), { wrapper: Wrapper });
      await waitFor(() => expect(engine.openEditor).toHaveBeenCalled());
      storageGoesSilent();

      await passSilence();

      await waitFor(() => expect(hook.result.current.data).toEqual({ userId: 'owner', title: 'Seen before' }));
      expect(hook.result.current.copySource).toBe('device');
    });

    it('prefers the server copy over an older device copy, whichever answers first', async () => {
      const engine = makeBrowser();
      const server = deferred<ResourceSnapshot>();
      engine.peekCached.mockResolvedValue(snapshot('Older', 1));
      engine.peekRemote.mockReturnValue(server.promise);
      const hook = renderHook(() => useDataDocument(resource, copyScreen), { wrapper: Wrapper });
      await waitFor(() => expect(engine.openEditor).toHaveBeenCalled());
      storageGoesSilent();
      await passSilence();
      await waitFor(() => expect(hook.result.current.data).toEqual({ userId: 'owner', title: 'Older' }));

      await act(async () => { server.resolve(snapshot('Newer', 4)); await server.promise; });

      expect(hook.result.current.data).toEqual({ userId: 'owner', title: 'Newer' });
      expect(hook.result.current.copySource).toBe('server');
    });

    it('asks again when the network comes back, instead of leaving the skeleton', async () => {
      const engine = makeBrowser();
      engine.peekCached.mockResolvedValue(undefined);
      engine.peekRemote.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(snapshot('Back online', 2));
      const hook = renderHook(() => useDataDocument(resource, copyScreen), { wrapper: Wrapper });
      await waitFor(() => expect(engine.openEditor).toHaveBeenCalled());
      storageGoesSilent();
      await passSilence();
      expect(hook.result.current.loading).toBe(true);

      await act(async () => { window.dispatchEvent(new Event('online')); await Promise.resolve(); });

      await waitFor(() => expect(hook.result.current.data).toEqual({ userId: 'owner', title: 'Back online' }));
    });

    it('keeps asking the server even when the device look itself never answers', async () => {
      const engine = makeBrowser();
      engine.peekCached.mockReturnValue(never());
      engine.peekRemote.mockRejectedValueOnce(new Error('church wifi')).mockResolvedValue(snapshot('Second try', 2));
      const hook = renderHook(() => useDataDocument(resource, copyScreen), { wrapper: Wrapper });
      await waitFor(() => expect(engine.openEditor).toHaveBeenCalled());
      storageGoesSilent();
      await passSilence();
      expect(hook.result.current.loading).toBe(true);

      await act(async () => { window.dispatchEvent(new Event('online')); await Promise.resolve(); });

      await waitFor(() => expect(hook.result.current.data).toEqual({ userId: 'owner', title: 'Second try' }));
    });

    it('treats a silent command journal as a reason to show the copy — opening waits on it after an interrupted save', async () => {
      const engine = makeBrowser();
      engine.peekRemote.mockResolvedValue(snapshot('Journal stuck'));
      const hook = renderHook(() => useDataDocument(resource, copyScreen), { wrapper: Wrapper });
      await waitFor(() => expect(engine.openEditor).toHaveBeenCalled());
      storageGoesSilent('engine-journal');

      await passSilence();

      await waitFor(() => expect(hook.result.current.data).toEqual({ userId: 'owner', title: 'Journal stuck' }));
    });

    it('asks for the next document at once and ignores the previous one\'s late answer', async () => {
      const engine = makeBrowser();
      const slowA = deferred<ResourceSnapshot>();
      const other = { collection: 'councils', id: 'council-2' };
      engine.peekRemote.mockImplementation(ref => ref.id === 'council-1' ? slowA.promise : Promise.resolve({ ...snapshot('Council B'), resource: other }));
      const hook = renderHook(({ ref }) => useDataDocument(ref, copyScreen), { wrapper: Wrapper, initialProps: { ref: resource } });
      await waitFor(() => expect(engine.openEditor).toHaveBeenCalled());
      storageGoesSilent();
      await passSilence();

      hook.rerender({ ref: other });
      await act(async () => { await jest.advanceTimersByTimeAsync(10); });
      await waitFor(() => expect(hook.result.current.data).toEqual({ userId: 'owner', title: 'Council B' }));
      const asksForB = () => engine.peekRemote.mock.calls.filter(([ref]) => ref.id === 'council-2').length;
      const before = asksForB();
      await act(async () => { slowA.resolve(snapshot('Council A')); await slowA.promise; });

      // B's copy was never knocked out by A's answer, so B was never asked for again.
      expect(asksForB()).toBe(before);
      expect(hook.result.current.data).toEqual({ userId: 'owner', title: 'Council B' });
    });

    it('does not re-read the device copy on every retry once it is on the screen', async () => {
      const engine = makeBrowser();
      engine.peekCached.mockResolvedValue(snapshot('Device copy'));
      engine.peekRemote.mockRejectedValue(new Error('offline'));
      const hook = renderHook(() => useDataDocument(resource, copyScreen), { wrapper: Wrapper });
      await waitFor(() => expect(engine.openEditor).toHaveBeenCalled());
      storageGoesSilent();
      await passSilence();
      await waitFor(() => expect(hook.result.current.copySource).toBe('device'));

      await act(async () => { await jest.advanceTimersByTimeAsync(20_000); });

      expect(engine.peekCached).toHaveBeenCalledTimes(1);
      expect(engine.peekRemote.mock.calls.length).toBeGreaterThan(1);
    });

    it('never shows a copy that answered after the editor had opened', async () => {
      const engine = makeBrowser();
      const opening = deferred<ManagedEditor>();
      const late = deferred<ResourceSnapshot>();
      engine.openEditor.mockReturnValue(opening.promise);
      engine.recoverEditor.mockReturnValue(never());
      engine.peekRemote.mockReturnValueOnce(late.promise).mockResolvedValue(snapshot('Fresh', 9));
      const hook = renderHook(() => useDataDocument(resource, copyScreen), { wrapper: Wrapper });
      await waitFor(() => expect(engine.openEditor).toHaveBeenCalled());
      storageGoesSilent();
      await passSilence();
      await act(async () => { opening.resolve(makeEditor('Editable')); await opening.promise; });
      await act(async () => { late.resolve(snapshot('Old', 1)); await late.promise; });
      expect(hook.result.current.data).toEqual({ userId: 'owner', title: 'Editable' });

      // A recovery reopens the editor; while it waits, only a copy looked up now may be shown.
      act(() => { void hook.result.current.recover('earlier').catch(() => undefined); });
      await act(async () => { await jest.advanceTimersByTimeAsync(10); });

      expect(hook.result.current.data).not.toEqual({ userId: 'owner', title: 'Old' });
      await waitFor(() => expect(hook.result.current.data).toEqual({ userId: 'owner', title: 'Fresh' }));
    });

    it('does not present an empty copy as "not found" — a document may exist only in this device\'s silent storage', async () => {
      const engine = makeBrowser();
      engine.peekRemote.mockResolvedValue({ resource, value: null, metadata: null });
      const hook = renderHook(() => useDataDocument(resource, copyScreen), { wrapper: Wrapper });
      await waitFor(() => expect(engine.openEditor).toHaveBeenCalled());
      storageGoesSilent();

      await passSilence();

      expect(engine.peekRemote).toHaveBeenCalled();
      expect(hook.result.current.loading).toBe(true);
      expect(hook.result.current.readOnly).toBe(false);
    });

    it('refuses an edit to the copy in words, so nothing typed is silently dropped', async () => {
      const engine = makeBrowser();
      engine.peekRemote.mockResolvedValue(snapshot('Bible Truck'));
      const hook = renderHook(() => useDataDocument(resource, copyScreen), { wrapper: Wrapper });
      await waitFor(() => expect(engine.openEditor).toHaveBeenCalled());
      storageGoesSilent();
      await passSilence();
      await waitFor(() => expect(hook.result.current.readOnly).toBe(true));

      await expect(hook.result.current.update(current => ({ ...current!, title: 'typed' }))).rejects.toMatchObject({ code: 'read-only', message: 'dataSync.readOnly.storage' });
      await expect(hook.result.current.remove()).rejects.toMatchObject({ code: 'read-only' });
    });

    it('returns editing by itself once storage answers, without a reload', async () => {
      const engine = makeBrowser();
      const opening = deferred<ManagedEditor>();
      engine.openEditor.mockReturnValue(opening.promise);
      engine.peekRemote.mockResolvedValue(snapshot('Server copy'));
      const hook = renderHook(() => useDataDocument(resource, copyScreen), { wrapper: Wrapper });
      await waitFor(() => expect(engine.openEditor).toHaveBeenCalled());
      storageGoesSilent();
      await passSilence();
      await waitFor(() => expect(hook.result.current.readOnly).toBe(true));

      await act(async () => { opening.resolve(makeEditor('Editable')); await opening.promise; });

      await waitFor(() => expect(hook.result.current.readOnly).toBe(false));
      expect(hook.result.current.data).toEqual({ userId: 'owner', title: 'Editable' });
      expect(hook.result.current.status?.phase).toBe('saved');
    });

    it('lets a slow but healthy opening become the editor it is about to be — no copy, no read-only flip', async () => {
      const engine = makeBrowser();
      const hook = renderHook(() => useDataDocument(resource, copyScreen), { wrapper: Wrapper });
      await waitFor(() => expect(engine.openEditor).toHaveBeenCalled());

      await act(async () => { await jest.advanceTimersByTimeAsync(SILENT * 4); });

      expect(engine.peekRemote).not.toHaveBeenCalled();
      expect(engine.peekCached).not.toHaveBeenCalled();
      expect(hook.result.current.loading).toBe(true);
      expect(hook.result.current.readOnly).toBe(false);
    });

    it('keeps a screen without a read-only form waiting, as before, rather than making it editable over a copy', async () => {
      const engine = makeBrowser();
      engine.peekRemote.mockResolvedValue(snapshot('Would be unsaveable'));
      const hook = renderHook(() => useDataDocument(resource), { wrapper: Wrapper });
      await waitFor(() => expect(engine.openEditor).toHaveBeenCalled());
      storageGoesSilent();

      await passSilence();

      expect(engine.peekRemote).not.toHaveBeenCalled();
      expect(hook.result.current.data).toBeNull();
      expect(hook.result.current.loading).toBe(true);
    });

    it('lets a form over the copy say why it cannot edit, without spinning or raising a drafts alarm', async () => {
      const engine = makeBrowser();
      engine.peekRemote.mockResolvedValue(snapshot('Series title'));
      const wrapper = ({ children }: { children: React.ReactNode }) => <Wrapper><DataDocumentProvider resource={resource} options={copyScreen}>{children}</DataDocumentProvider></Wrapper>;
      const hook = renderHook(() => useDataForm(resource, 'metadata', [['title']]), { wrapper });
      await waitFor(() => expect(engine.openEditor).toHaveBeenCalled());
      storageGoesSilent();
      await passSilence();
      await waitFor(() => expect(hook.result.current.readOnly).toBe(true));

      expect(hook.result.current.loading).toBe(false);
      expect(hook.result.current.data).toEqual({ userId: 'owner', title: 'Series title' });
      expect(hook.result.current.error).toBe('dataSync.readOnly.storage');
      await expect(hook.result.current.listRecoverable()).resolves.toEqual([]);
      await expect(hook.result.current.save()).rejects.toMatchObject({ code: 'read-only' });
    });

    it('stops looking for saved drafts that storage cannot list, and says why', async () => {
      const engine = makeBrowser();
      engine.openEditor.mockResolvedValue(makeEditor('Opened'));
      const hook = renderHook(() => useDataDocument(resource), { wrapper: Wrapper });
      await waitFor(() => expect(hook.result.current.data).not.toBeNull());

      let outcome!: Promise<unknown>;
      act(() => { outcome = hook.result.current.listRecoverable().then(() => 'listed', (error: unknown) => error); });
      storageGoesSilent();
      await passSilence();

      expect(await outcome).toMatchObject({ code: 'storage-silent' });
    });
  });

  describe('a list', () => {
    const listState = (titles: string[]): CollectionState => ({
      snapshots: titles.map((title, index) => ({ ...snapshot(title), resource: { collection: 'councils', id: `c${index}` } })),
      documents: [], complete: true, freshness: 'server', checking: false, version: 1, error: null,
    });

    it('shows the server list when the list cache is silent', async () => {
      const engine = makeBrowser();
      engine.peekCollectionRemote.mockResolvedValue(listState(['Bible Truck', 'Budget']));
      const hook = renderHook(() => useDataCollection('councils'), { wrapper: Wrapper });
      await waitFor(() => expect(engine.watchCollection).toHaveBeenCalled());
      storageGoesSilent('engine-cursors');
      expect(hook.result.current.loading).toBe(true);

      await passSilence();

      await waitFor(() => expect(hook.result.current.state?.snapshots).toHaveLength(2));
      expect(hook.result.current.loading).toBe(false);
      expect(hook.result.current.readOnly).toBe(true);
    });

    it('does not reach for a copy while the list is merely slow', async () => {
      const engine = makeBrowser();
      renderHook(() => useDataCollection('councils'), { wrapper: Wrapper });
      await waitFor(() => expect(engine.watchCollection).toHaveBeenCalled());
      storageGoesSilent('engine-state');

      await act(async () => { await jest.advanceTimersByTimeAsync(SILENT * 3); });

      expect(engine.peekCollectionRemote).not.toHaveBeenCalled();
    });

    it('goes back to the live list as soon as it answers', async () => {
      const engine = makeBrowser();
      let emit!: (state: CollectionState) => void;
      engine.watchCollection.mockImplementation(((_collection: string, next: (state: CollectionState) => void) => { emit = next; return () => undefined; }) as never);
      engine.peekCollectionRemote.mockResolvedValue(listState(['Copy']));
      const hook = renderHook(() => useDataCollection('councils'), { wrapper: Wrapper });
      await waitFor(() => expect(engine.watchCollection).toHaveBeenCalled());
      storageGoesSilent('engine-snapshots');
      await passSilence();
      await waitFor(() => expect(hook.result.current.readOnly).toBe(true));

      act(() => emit(listState(['Live', 'Also live'])));

      expect(hook.result.current.readOnly).toBe(false);
      expect(hook.result.current.state?.snapshots).toHaveLength(2);
    });
  });

  describe('one action from a menu', () => {
    it('does not wait forever and never lands later without the person knowing', async () => {
      const engine = makeBrowser();
      const opening = deferred<ManagedEditor>();
      let signal: AbortSignal | undefined;
      engine.listRecoverable.mockResolvedValue([] as never);
      engine.listPending.mockResolvedValue([] as never);
      engine.openEditor.mockImplementation((_ref, _id, options) => { signal = options?.signal; return opening.promise; });
      const hook = renderHook(() => useDocumentActions(), { wrapper: Wrapper });
      await waitFor(() => expect(hook.result.current.ready).toBe(true));

      let outcome!: Promise<unknown>;
      act(() => { outcome = hook.result.current.remove(resource).then(() => 'removed', (error: unknown) => error); });
      await waitFor(() => expect(engine.openEditor).toHaveBeenCalled());
      // The editor's storage goes silent while the opening is on its way.
      storageGoesSilent();
      await passSilence();

      expect(await outcome).toMatchObject({ code: 'storage-silent' });
      expect(signal?.aborted).toBe(true);
      const editor = makeEditor('Late');
      await act(async () => { opening.resolve(editor); await opening.promise; });
      expect(editor.remove).not.toHaveBeenCalled();
    });

    it('is not refused because the list cache is silent', async () => {
      const engine = makeBrowser();
      const opening = deferred<ManagedEditor>();
      engine.listRecoverable.mockResolvedValue([] as never);
      engine.listPending.mockResolvedValue([] as never);
      engine.openEditor.mockReturnValue(opening.promise);
      const hook = renderHook(() => useDocumentActions(), { wrapper: Wrapper });
      await waitFor(() => expect(hook.result.current.ready).toBe(true));

      let outcome!: Promise<unknown>;
      act(() => { outcome = hook.result.current.remove(resource).then(() => 'removed', (error: unknown) => error); });
      await waitFor(() => expect(engine.openEditor).toHaveBeenCalled());
      storageGoesSilent('engine-cursors');
      await passSilence();
      const editor = makeEditor('Opened');
      await act(async () => { opening.resolve(editor); await opening.promise; });

      expect(await outcome).toBe('removed');
      expect(editor.remove).toHaveBeenCalledTimes(1);
    });
  });

  describe('a background failure elsewhere in the engine (BUG-20260927-engine-background-error-sticks-on-every-screen)', () => {
    const failInBackground = (text: string) => act(() => {
      const options = jest.mocked(createBrowserDataEngine).mock.calls.at(-1)?.[0];
      options?.onError?.(new Error(text));
    });

    it('does not hide a copy shown while storage is silent', async () => {
      const engine = makeBrowser();
      engine.peekRemote.mockResolvedValue(snapshot('Copy'));
      const hook = renderHook(() => useDataDocument(resource, copyScreen), { wrapper: Wrapper });
      await waitFor(() => expect(engine.openEditor).toHaveBeenCalled());
      storageGoesSilent();
      await passSilence();
      await waitFor(() => expect(hook.result.current.readOnly).toBe(true));

      failInBackground('Data engine unavailable');

      expect(hook.result.current.error).toBeNull();
      expect(hook.result.current.data).toEqual({ userId: 'owner', title: 'Copy' });
    });

    it('still explains an empty screen when nothing could be opened', async () => {
      makeBrowser();
      const hook = renderHook(() => useDataDocument(resource), { wrapper: Wrapper });

      failInBackground('Data engine unavailable');

      // Said in words from the locales, not in the engine's developer sentence.
      expect(hook.result.current.error).toBe('dataSync.backgroundFailure');
    });

    it('does not stop a list that is still waiting from being offered a copy', async () => {
      const engine = makeBrowser();
      engine.peekCollectionRemote.mockResolvedValue({ snapshots: [snapshot('Row')], documents: [], complete: true, freshness: 'server', checking: false, version: 1, error: null });
      const hook = renderHook(() => useDataCollection('councils'), { wrapper: Wrapper });
      await waitFor(() => expect(engine.watchCollection).toHaveBeenCalled());
      failInBackground('Collection cache is unavailable');
      storageGoesSilent('engine-cursors');

      await passSilence();

      await waitFor(() => expect(hook.result.current.readOnly).toBe(true));
      expect(hook.result.current.state?.snapshots).toHaveLength(1);
    });
  });
});
