import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { useAuth } from '@/providers/AuthProvider';

import { createBrowserDataEngine, type BrowserDataEngine } from '../browser.client';
import { DataDocumentProvider, DataEngineProvider, DataEngineWorkspace, isCollectionOnEngine, isDataEngineEnabled, useDataCollection, useDataDocument, useDataEngine, useDataForm } from '../react.client';

import type { CollectionState } from '../collections';
import type { EditorState, RecoveryCheckpoint } from '../controller';
import type { ManagedEditor, ManagedManualForm } from '../engine';
import type { Observation } from '../observer';
import type { JournalEntry, ResourceRef, ResourceSnapshot } from '../types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../browser.client', () => ({ createBrowserDataEngine: jest.fn() }));

const resource = { collection: 'studyNotes', id: 'note' };
const snapshot = (content = 'base', revision = 1): ResourceSnapshot => ({ resource, value: { content }, metadata: { protocol: 1, generation: 'gen', revision, deleted: false } });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const owner = (uid: string | null) => jest.mocked(useAuth).mockReturnValue({ user: uid ? { uid } : null, loading: false, isAuthenticated: Boolean(uid) } as ReturnType<typeof useAuth>);
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const Wrapper = ({ children }: { children: React.ReactNode }) => <DataEngineProvider>{children}</DataEngineProvider>;

function makeEditor() {
  let state: EditorState = { durable: true, error: null, result: null, checkpoint: { confirmed: snapshot(), draft: { content: 'base' }, dirty: false, editGeneration: 0, pending: {}, conflicts: [], remoteCandidate: null } };
  let observation: Observation = { snapshot: snapshot(), source: 'server', readiness: 'server', checking: false, error: false };
  let delivery: JournalEntry[] = [];
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  let sequence = 0;
  const editor: ManagedEditor = {
    form: jest.fn(),
    getState: jest.fn(() => clone(state)), getObservation: jest.fn(() => clone(observation)), getDelivery: jest.fn(() => clone(delivery)),
    subscribe: jest.fn(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }),
    edit: jest.fn(async value => {
      state = { ...state, durable: true, checkpoint: { ...state.checkpoint, draft: value, dirty: true, editGeneration: state.checkpoint.editGeneration + 1 } }; emit();
    }),
    commit: jest.fn(async updater => {
      const staged = editor.edit(updater(state.checkpoint.draft));
      const saved = editor.save();
      await Promise.all([staged, saved]);
    }),
    save: jest.fn(async () => {
      const id = `op-${++sequence}`;
      state = { ...state, checkpoint: { ...state.checkpoint, pending: { ...state.checkpoint.pending, [id]: { generation: state.checkpoint.editGeneration, value: state.checkpoint.draft } } } }; emit();
    }),
    acceptRemote: jest.fn(async () => undefined), keepLocal: jest.fn(async () => undefined), remove: jest.fn(async () => undefined), dispose: jest.fn(), close: jest.fn(),
  };
  return {
    editor, emit,
    get state() { return state; },
    setState: (next: EditorState) => { state = clone(next); emit(); },
    setObservation: (next: Observation) => { observation = next; emit(); },
    setDelivery: (next: JournalEntry[]) => { delivery = next; emit(); },
  };
}
function makeBrowser(editor = makeEditor().editor) {
  const collectionWatches: { collection: string; next: (state: CollectionState) => void; stop: jest.Mock }[] = [];
  const engine = {
    setOwner: jest.fn(), openEditor: jest.fn<Promise<ManagedEditor>, [ResourceRef, string, { signal?: AbortSignal }?]>(async () => editor),
    createEditor: jest.fn<Promise<ManagedEditor>, [ResourceRef, string, { signal?: AbortSignal }?]>(async () => editor), retry: jest.fn(async () => undefined),
    recoverEditor: jest.fn<Promise<ManagedEditor>, [ResourceRef, string, string, { signal?: AbortSignal }?]>(async () => editor),
    listRecoverable: jest.fn<Promise<RecoveryCheckpoint[]>, [ResourceRef?]>(async () => []),
    watchCollection: jest.fn((collection: string, next: (state: CollectionState) => void) => { const stop = jest.fn(); collectionWatches.push({ collection, next, stop }); return stop; }),
    refreshCollection: jest.fn<Promise<CollectionState>, [string]>(),
  };
  const browser: BrowserDataEngine = { engine: engine as unknown as BrowserDataEngine['engine'], dispose: jest.fn(), editorId: jest.fn((ref, slot) => JSON.stringify([ref.collection, ref.id, slot])) };
  return { browser, engine, collectionWatches };
}

function makeManualForm() {
  let state: ReturnType<ManagedManualForm['getState']> = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  const form: ManagedManualForm = {
    propose: jest.fn(),
    resolve: jest.fn(),
    getState: () => state && clone(state),
    subscribe: jest.fn(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }),
    begin: jest.fn(async () => {
      state = { value: { content: 'base' }, openingValue: { content: 'base' }, durable: true, dirty: false, record: { kind: 'manual', version: 1, owner: 'owner', scopeId: 'scope', resource,
        selection: [['content']], baseline: snapshot(), predecessor: null, stage: [{ exists: true, value: 'base' }], savedSelection: [{ exists: true, value: 'base' }], generation: 0, savedGeneration: null, active: true } }; emit();
    }),
    update: jest.fn(async updater => { state = { ...state!, value: updater(state!.value), dirty: true }; emit(); }),
    save: jest.fn(async updater => { if (updater) state!.value = updater(state!.value); state!.record.active = false; state!.dirty = false; emit(); }),
    cancel: jest.fn(async () => { state!.record.active = false; emit(); }),
    retry: jest.fn(async () => undefined), listRecoverable: jest.fn(async () => []), recover: jest.fn(async () => { await form.begin(); }),
  };
  return { form, emit, listeners };
}

describe('React DataEngine contract', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); owner('owner'); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('exposes asynchronous checkpoint failures and clears them after durable recovery', async () => {
    const editor = makeEditor(), browser = makeBrowser(editor.editor);
    jest.mocked(createBrowserDataEngine).mockReturnValue(browser.browser);
    const hook = renderHook(() => useDataDocument(resource), { wrapper: Wrapper });
    await waitFor(() => expect(hook.result.current.state).not.toBeNull());
    act(() => editor.setState({ ...editor.state, durable: false, error: 'Checkpoint transaction failed' }));
    expect(hook.result.current.status?.phase).toBe('localFailure');
    expect(hook.result.current.error).toBe('Checkpoint transaction failed');
    act(() => editor.setState({ ...editor.state, durable: true, error: null }));
    expect(hook.result.current.error).toBeNull();
  });

  it('shares its parent editor and stages manual typing without autosave or per-key busy state', async () => {
    const parent = makeEditor(), manual = makeManualForm(), browser = makeBrowser(parent.editor);
    jest.mocked(parent.editor.form).mockReturnValue(manual.form); jest.mocked(createBrowserDataEngine).mockReturnValue(browser.browser);
    const wrapper = ({ children }: { children: React.ReactNode }) => <Wrapper><DataDocumentProvider resource={resource}>{children}</DataDocumentProvider></Wrapper>;
    const hook = renderHook(() => useDataForm(resource, 'content', [['content']]), { wrapper });
    await waitFor(() => expect(manual.form.subscribe).toHaveBeenCalledTimes(1));
    expect(browser.engine.openEditor).toHaveBeenCalledTimes(1); expect(manual.form.begin).not.toHaveBeenCalled();
    await act(async () => { await hook.result.current.begin(); }); expect(hook.result.current.active).toBe(true);
    const pending = deferred<void>(); const update = jest.mocked(manual.form.update).getMockImplementation()!;
    jest.mocked(manual.form.update).mockImplementationOnce(updater => { void update(updater); return pending.promise; });
    let typing!: Promise<void>; act(() => { typing = hook.result.current.update(value => ({ ...value, content: 'typed' })); });
    expect(hook.result.current.busy).toBe(false);
    expect(hook.result.current.status).toMatchObject({ phase: 'draft', canSave: true });
    act(() => parent.setState({ ...parent.state, checkpoint: { ...parent.state.checkpoint,
      confirmed: snapshot('remote', 2), draft: { content: 'remote' } } }));
    expect(hook.result.current.data?.content).toBe('typed');
    expect(hook.result.current.initialData?.content).toBe('base');
    expect(hook.result.current.status).toMatchObject({ phase: 'remoteChanged', hasForeignChange: true });
    await act(async () => { pending.resolve(); await typing; });
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(parent.editor.save).not.toHaveBeenCalled(); expect(manual.form.save).not.toHaveBeenCalled();
    await act(async () => { await hook.result.current.save(value => ({ ...value, content: 'trimmed' })); });
    expect(manual.form.save).toHaveBeenCalledTimes(1); expect(hook.result.current.active).toBe(false);
    hook.unmount(); expect(manual.listeners.size).toBe(0);
  });

  it('exposes manual recovery explicitly and fences old-owner failures and actions', async () => {
    const parent = makeEditor(), manual = makeManualForm(), browser = makeBrowser(parent.editor);
    jest.mocked(parent.editor.form).mockReturnValue(manual.form); jest.mocked(createBrowserDataEngine).mockReturnValue(browser.browser);
    const hook = renderHook(() => useDataForm(resource, 'content', [['content']]), { wrapper: Wrapper });
    await waitFor(() => expect(manual.form.subscribe).toHaveBeenCalled());
    expect(manual.form.listRecoverable).not.toHaveBeenCalled(); expect(manual.form.recover).not.toHaveBeenCalled();
    await act(async () => { expect(await hook.result.current.listRecoverable()).toEqual([]); await hook.result.current.recover('chosen'); });
    expect(manual.form.recover).toHaveBeenCalledWith('chosen');
    const pending = deferred<void>(); jest.mocked(manual.form.save).mockReturnValueOnce(pending.promise);
    let saving!: Promise<void>; act(() => { saving = hook.result.current.save(); }); const caught = saving.catch(error => error);
    expect(hook.result.current.busy).toBe(true);
    const stale = hook.result.current;
    owner(null); hook.rerender();
    await act(async () => { pending.reject(new Error('old owner quota')); await caught; });
    expect(hook.result.current.error).not.toBe('old owner quota'); expect(hook.result.current.active).toBe(false);
    await expect(stale.begin()).rejects.toThrow('not ready');
    hook.unmount();
  });

  it('shares one document baseline and journal across workspace fields with different slots', async () => {
    const s = makeEditor(); const b = makeBrowser(s.editor);
    jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    let core!: ReturnType<typeof useDataDocument>;
    let scratch!: ReturnType<typeof useDataDocument>;
    function Core() { core = useDataDocument(resource, { slot: 'core' }); return <p>{String(core.data?.title ?? '')}</p>; }
    function Scratch() { scratch = useDataDocument(resource, { slot: 'scratch' }); return null; }
    function Workspace({ showScratch = true }) {
      return <Wrapper><DataDocumentProvider resource={resource} options={{ autoSave: false }}><Core />{showScratch && <Scratch />}</DataDocumentProvider></Wrapper>;
    }
    const view = render(<Workspace />);
    await waitFor(() => expect(core.data?.content).toBe('base'));
    expect(b.browser.engine.openEditor).toHaveBeenCalledTimes(1);
    expect(core).toBe(scratch);
    await act(async () => {
      const first = core.update(current => ({ ...current, title: 'New title' }));
      const second = scratch.update(current => ({ ...current, content: 'New note' }));
      await Promise.all([first, second]);
    });
    expect(core.data).toEqual({ content: 'New note', title: 'New title' });
    expect(scratch.data).toBe(core.data);
    await act(async () => jest.advanceTimersByTime(2_000));
    expect(s.editor.save).not.toHaveBeenCalled();
    view.rerender(<Workspace showScratch={false} />);
    expect(s.editor.dispose).not.toHaveBeenCalled();
    expect(core.data?.content).toBe('New note');
    await act(async () => core.save());
    expect(s.editor.save).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(s.editor.close).toHaveBeenCalledTimes(1);
  });

  it('captures an explicit commit before later typing while persistence is still pending', async () => {
    const s = makeEditor(); const b = makeBrowser(s.editor);
    jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const durable = deferred<void>();
    const originalEdit = s.editor.edit;
    jest.mocked(s.editor.edit).mockImplementationOnce(value => {
      // The draft changes synchronously; storage may take arbitrarily long.
      s.setState({ ...s.state, checkpoint: { ...s.state.checkpoint, draft: value } });
      return durable.promise;
    });
    const { result } = renderHook(() => useDataDocument(resource, { autoSave: false }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let saving!: Promise<void>;
    act(() => { saving = result.current.commit(current => ({ ...current, content: 'Saved B' })); });
    expect(s.editor.commit).toHaveBeenCalledTimes(1);
    expect(s.state.checkpoint.pending['op-1'].value).toEqual({ content: 'Saved B' });
    await act(async () => result.current.update(current => ({ ...current, content: 'Unsaved C' })));
    expect(s.state.checkpoint.draft).toEqual({ content: 'Unsaved C' });
    expect(s.state.checkpoint.pending['op-1'].value).toEqual({ content: 'Saved B' });
    await act(async () => { durable.resolve(); await saving; });
    expect(originalEdit).toHaveBeenCalledTimes(2);
    expect(s.editor.save).toHaveBeenCalledTimes(1);
  });

  it('opens an independent editor for another resource under a document provider', async () => {
    const s = makeEditor(); const b = makeBrowser(s.editor);
    jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const other = { collection: 'studyNotes', id: 'other' };
    const { result } = renderHook(() => useDataDocument(other), {
      wrapper: ({ children }) => <Wrapper><DataDocumentProvider resource={resource}>{children}</DataDocumentProvider></Wrapper>,
    });
    await waitFor(() => expect(result.current.data?.content).toBe('base'));
    expect(b.browser.engine.openEditor).toHaveBeenCalledTimes(2);
    expect(b.browser.engine.openEditor).toHaveBeenCalledWith(other, expect.any(String), expect.anything());
  });

  it('mounts the engine only for an explicitly enabled coordinated cutover', () => {
    const original = process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
    try {
      delete process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
      expect(isDataEngineEnabled()).toBe(false);
      const disabled = render(<DataEngineWorkspace><p>Legacy workspace</p></DataEngineWorkspace>);
      expect(screen.getByText('Legacy workspace')).toBeInTheDocument();
      expect(createBrowserDataEngine).not.toHaveBeenCalled();
      disabled.unmount();
      process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED = 'false';
      expect(isDataEngineEnabled()).toBe(false);
      process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED = 'true';
      const s = makeEditor(); const b = makeBrowser(s.editor);
      jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
      const enabled = render(<DataEngineWorkspace><p>Engine workspace</p></DataEngineWorkspace>);
      expect(isDataEngineEnabled()).toBe(true);
      expect(screen.getByText('Engine workspace')).toBeInTheDocument();
      expect(createBrowserDataEngine).toHaveBeenCalledTimes(1);
      enabled.unmount();
      expect(b.browser.dispose).toHaveBeenCalledTimes(1);
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
      else process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED = original;
    }
  });

  // A domain migrates as a whole, so the switch has to be per collection: enabling the
  // engine for a migrated domain must not also route an unmigrated one through it.
  it('routes only the listed collections through the engine', () => {
    const enabled = process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
    const collections = process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
    try {
      delete process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
      delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
      expect(isCollectionOnEngine('councils')).toBe(false);
      expect(isDataEngineEnabled()).toBe(false);

      process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = ' councils , prayerRequests ';
      expect(isCollectionOnEngine('councils')).toBe(true);
      expect(isCollectionOnEngine('prayerRequests')).toBe(true);
      expect(isCollectionOnEngine('sermons')).toBe(false);
      // The workspace still mounts: one migrated collection needs the engine alive.
      expect(isDataEngineEnabled()).toBe(true);

      delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
      process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED = 'true';
      expect(isCollectionOnEngine('sermons')).toBe(true);
      expect(isCollectionOnEngine('councils')).toBe(true);
    } finally {
      if (enabled === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
      else process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED = enabled;
      if (collections === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
      else process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = collections;
    }
  });

  it('waits for durable typing and queues a successor once without requiring the earlier ACK', async () => {
    const s = makeEditor(); const b = makeBrowser(s.editor); jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result, unmount } = renderHook(() => useDataDocument(resource), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ content: 'base' }));
    await act(async () => s.setState({ ...s.state, durable: false, checkpoint: { ...s.state.checkpoint, draft: { content: 'A' }, dirty: true, editGeneration: 1 } }));
    expect(s.editor.save).not.toHaveBeenCalled(); expect(result.current.status?.phase).toBe('savingLocally');
    await act(async () => s.setState({ ...s.state, durable: true }));
    await act(async () => jest.advanceTimersByTime(749)); expect(s.editor.save).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(1));
    expect(s.editor.save).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.edit({ content: 'B' }); });
    await act(async () => { s.emit(); jest.advanceTimersByTime(2_000); });
    expect(s.editor.save).toHaveBeenCalledTimes(2);
    expect(s.state.checkpoint.pending['op-1'].value).toEqual({ content: 'A' });
    expect(s.state.checkpoint.pending['op-2'].value).toEqual({ content: 'B' });
    await act(async () => s.setState({ ...s.state, checkpoint: { ...s.state.checkpoint, confirmed: snapshot('A', 2), pending: { 'op-2': s.state.checkpoint.pending['op-2'] } } }));
    expect(result.current.data).toEqual({ content: 'B' });
    await act(async () => { s.emit(); jest.advanceTimersByTime(2_000); });
    expect(s.editor.save).toHaveBeenCalledTimes(2);
    unmount(); expect(b.browser.dispose).toHaveBeenCalledTimes(1); expect(s.editor.close).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('keeps resolution explicit with autoSave=%s', async autoSave => {
    const s = makeEditor(); const b = makeBrowser(s.editor); jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    s.setState({ ...s.state, checkpoint: { ...s.state.checkpoint, draft: { content: 'mine' }, dirty: true, conflicts: [{ path: ['content'], base: { exists: true, value: 'base' }, mine: { exists: true, value: 'mine' }, theirs: { exists: true, value: 'remote' } }], remoteCandidate: snapshot('remote', 2) } });
    jest.mocked(s.editor.keepLocal).mockImplementation(async () => { s.setState({ ...s.state, checkpoint: { ...s.state.checkpoint, confirmed: snapshot('remote', 2), remoteCandidate: null, conflicts: [], editGeneration: 1 } }); });
    const { result } = renderHook(() => useDataDocument(resource, { autoSave }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.status?.canKeepLocal).toBe(true));
    expect(s.editor.save).not.toHaveBeenCalled();
    await act(async () => { await result.current.keepLocal(); });
    expect(s.editor.keepLocal).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(750));
    expect(s.editor.save).toHaveBeenCalledTimes(autoSave ? 1 : 0);
    if (!autoSave) { await act(async () => { await result.current.save(); }); expect(s.editor.save).toHaveBeenCalledTimes(1); }
  });

  it('retries a failed open, supports explicit create, and forwards refresh and remote acceptance', async () => {
    const s = makeEditor(); const b = makeBrowser(s.editor); b.engine.openEditor.mockRejectedValueOnce(new Error('read unavailable'));
    jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result, rerender } = renderHook(({ create }) => useDataDocument(resource, { create, autoSave: false }), { wrapper: Wrapper, initialProps: { create: false } });
    await waitFor(() => expect(result.current.error).toBe('read unavailable'));
    await act(async () => { await result.current.retry(); });
    await waitFor(() => expect(result.current.data).toEqual({ content: 'base' }));
    expect(b.engine.openEditor).toHaveBeenCalledTimes(2);
    await act(async () => { await result.current.retry(); await result.current.acceptRemote(); });
    expect(b.engine.retry).toHaveBeenCalledTimes(1); expect(s.editor.acceptRemote).toHaveBeenCalledTimes(1);
    rerender({ create: true });
    await waitFor(() => expect(b.engine.createEditor).toHaveBeenCalledTimes(1));
  });

  it('disposes an editor that finishes opening after unmount', async () => {
    const s = makeEditor(); const b = makeBrowser(s.editor); const opening = deferred<ManagedEditor>(); b.engine.openEditor.mockReturnValue(opening.promise);
    jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result, unmount } = renderHook(() => useDataDocument(resource), { wrapper: Wrapper });
    await waitFor(() => expect(b.engine.openEditor).toHaveBeenCalledTimes(1));
    const signal = b.engine.openEditor.mock.calls[0][2]?.signal;
    expect(signal?.aborted).toBe(false);
    expect(result.current.loading).toBe(true); unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => opening.resolve(s.editor));
    expect(s.editor.dispose).toHaveBeenCalledTimes(1); expect(s.editor.subscribe).not.toHaveBeenCalled();
  });

  it('never opens the old owner engine after the provider owner changes', async () => {
    const first = makeBrowser(), second = makeBrowser(); jest.mocked(createBrowserDataEngine).mockReturnValueOnce(first.browser).mockReturnValue(second.browser);
    const { result, rerender } = renderHook(() => useDataDocument(resource, { autoSave: false }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    owner('other'); rerender();
    await waitFor(() => expect(second.engine.openEditor).toHaveBeenCalledTimes(1));
    expect(first.engine.openEditor).toHaveBeenCalledTimes(1);
    expect(first.browser.dispose).toHaveBeenCalledTimes(1); expect(second.engine.setOwner).toHaveBeenCalledWith('other');
  });

  it('keeps errors from late old-owner actions out of the new owner view', async () => {
    const old = makeEditor(); const first = makeBrowser(old.editor), second = makeBrowser();
    const saving = deferred<void>(); jest.mocked(old.editor.save).mockReturnValue(saving.promise);
    jest.mocked(createBrowserDataEngine).mockReturnValueOnce(first.browser).mockReturnValue(second.browser);
    const { result, rerender } = renderHook(() => useDataDocument(resource, { autoSave: false }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ content: 'base' }));
    let action!: Promise<void>;
    await act(async () => { action = result.current.save(); void action.catch(() => undefined); });
    owner('other'); rerender(); await waitFor(() => expect(second.engine.openEditor).toHaveBeenCalledTimes(1));
    await act(async () => { saving.reject(new Error('old owner failure')); await action.catch(() => undefined); });
    expect(result.current.error).toBeNull();
  });

  it('suppresses late autosave and provider errors after owner replacement', async () => {
    const old = makeEditor(); old.setState({ ...old.state, checkpoint: { ...old.state.checkpoint, draft: { content: 'mine' }, dirty: true } });
    const pending = deferred<void>(); jest.mocked(old.editor.save).mockReturnValue(pending.promise);
    const first = makeBrowser(old.editor), second = makeBrowser();
    jest.mocked(createBrowserDataEngine).mockReturnValueOnce(first.browser).mockReturnValue(second.browser);
    const { result, rerender } = renderHook(() => useDataDocument(resource), { wrapper: Wrapper });
    await waitFor(() => expect(old.editor.save).toHaveBeenCalledTimes(1));
    const oldError = jest.mocked(createBrowserDataEngine).mock.calls[0][0]?.onError;
    owner('other'); rerender(); await waitFor(() => expect(second.engine.openEditor).toHaveBeenCalledTimes(1));
    await act(async () => { pending.reject(new Error('old autosave failure')); oldError?.(new Error('old provider failure')); });
    expect(result.current.error).toBeNull();
  });

  it('does not reuse a disposed editor when navigation returns before an intervening open finishes', async () => {
    const first = makeEditor(), replacement = makeEditor(), middle = makeEditor(); const b = makeBrowser(first.editor);
    const middleOpen = deferred<ManagedEditor>(), replacementOpen = deferred<ManagedEditor>();
    b.engine.openEditor.mockResolvedValueOnce(first.editor).mockReturnValueOnce(middleOpen.promise).mockReturnValueOnce(replacementOpen.promise);
    jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result, rerender, unmount } = renderHook(({ id }) => useDataDocument({ ...resource, id }, { autoSave: false }), { wrapper: Wrapper, initialProps: { id: 'note' } });
    await waitFor(() => expect(result.current.data).toEqual({ content: 'base' }));
    rerender({ id: 'middle' }); await waitFor(() => expect(b.engine.openEditor).toHaveBeenCalledTimes(2));
    rerender({ id: 'note' }); await waitFor(() => expect(b.engine.openEditor).toHaveBeenCalledTimes(3));
    expect(first.editor.close).toHaveBeenCalledWith({ flush: false });
    expect(result.current.loading).toBe(true); expect(result.current.data).toBeNull();
    await act(async () => { middleOpen.resolve(middle.editor); replacementOpen.resolve(replacement.editor); });
    expect(middle.editor.dispose).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false); unmount();
  });

  it('does not show a failed old action after navigating away and reopening the same resource', async () => {
    const first = makeEditor(), replacement = makeEditor(); const b = makeBrowser(first.editor);
    const middleOpen = deferred<ManagedEditor>(), saving = deferred<void>(); jest.mocked(first.editor.save).mockReturnValue(saving.promise);
    b.engine.openEditor.mockResolvedValueOnce(first.editor).mockReturnValueOnce(middleOpen.promise).mockResolvedValueOnce(replacement.editor);
    jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result, rerender } = renderHook(({ id }) => useDataDocument({ ...resource, id }, { autoSave: false }), { wrapper: Wrapper, initialProps: { id: 'note' } });
    await waitFor(() => expect(result.current.data).toEqual({ content: 'base' }));
    let action!: Promise<void>; await act(async () => { action = result.current.save(); void action.catch(() => undefined); });
    rerender({ id: 'middle' }); await waitFor(() => expect(b.engine.openEditor).toHaveBeenCalledTimes(2));
    rerender({ id: 'note' }); await waitFor(() => expect(replacement.editor.subscribe).toHaveBeenCalledTimes(1));
    await act(async () => { saving.reject(new Error('obsolete same-resource failure')); await action.catch(() => undefined); });
    expect(result.current.error).toBeNull();
  });

  it('does not open without a resource and exposes provider background errors', async () => {
    const b = makeBrowser(); jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result } = renderHook(() => useDataDocument(null), { wrapper: Wrapper });
    expect(result.current.loading).toBe(false); expect(b.engine.openEditor).not.toHaveBeenCalled();
    await act(async () => jest.mocked(createBrowserDataEngine).mock.calls[0][0]?.onError?.(new Error('storage failed')));
    expect(result.current.error).toBe('storage failed');
    await expect(result.current.edit({ content: 'not ready' })).rejects.toThrow('not ready');
  });

  it('does not open documents after logout', async () => {
    owner(null); const b = makeBrowser(); jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result } = renderHook(() => useDataDocument(resource), { wrapper: Wrapper });
    expect(result.current.loading).toBe(false); expect(result.current.data).toBeNull();
    expect(b.engine.openEditor).not.toHaveBeenCalled();
  });

  // BUG-20260919-engine-leaving-strands-last-edit: leaving is a moment to save, not to forget.
  it.each([true, false])('asks the engine to keep what was typed when the screen goes away (autoSave=%s)', async autoSave => {
    const s = makeEditor(); const b = makeBrowser(s.editor); jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result, unmount } = renderHook(() => useDataDocument(resource, { autoSave }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.edit({ content: 'typed and gone' }); });
    unmount();
    expect(s.editor.close).toHaveBeenCalledWith({ flush: autoSave });
    expect(s.editor.dispose).not.toHaveBeenCalled();
  });

  it('saves at once when the page is hidden instead of waiting out the autosave delay', async () => {
    const s = makeEditor(); const b = makeBrowser(s.editor); jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result } = renderHook(() => useDataDocument(resource), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.edit({ content: 'typed, then the app was switched' }); });
    expect(s.editor.save).not.toHaveBeenCalled();
    const visibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(s.editor.save).toHaveBeenCalledTimes(1);
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState;
      if (visibility) Object.defineProperty(Document.prototype, 'visibilityState', visibility);
    }
  });

  it('persists each keystroke immediately and debounces a typing burst without status-only timer resets', async () => {
    const s = makeEditor(); const b = makeBrowser(s.editor); jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result } = renderHook(() => useDataDocument(resource), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ content: 'base' }));
    for (const content of ['A', 'AB', 'ABC']) {
      await act(async () => { await result.current.edit({ content }); });
      expect(result.current.data).toEqual({ content });
      expect(s.editor.save).not.toHaveBeenCalled();
      if (content !== 'ABC') await act(async () => jest.advanceTimersByTime(500));
    }
    expect(s.editor.edit).toHaveBeenCalledTimes(3);
    await act(async () => jest.advanceTimersByTime(500));
    await act(async () => s.setObservation({ snapshot: snapshot(), source: 'server', readiness: 'server', checking: true, error: false }));
    await act(async () => jest.advanceTimersByTime(249)); expect(s.editor.save).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(1)); expect(s.editor.save).toHaveBeenCalledTimes(1);
    expect(s.state.checkpoint.pending['op-1'].value).toEqual({ content: 'ABC' });
  });

  it('reports a delivery failure even after pending status cancels the completed debounce effect', async () => {
    const s = makeEditor(); const b = makeBrowser(s.editor); const saving = deferred<void>();
    jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    jest.mocked(s.editor.save).mockImplementation(async () => {
      s.setState({ ...s.state, checkpoint: { ...s.state.checkpoint, pending: { submitted: { generation: 1, value: s.state.checkpoint.draft } } } });
      await saving.promise;
    });
    const { result } = renderHook(() => useDataDocument(resource), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.edit({ content: 'mine' }); });
    await act(async () => jest.advanceTimersByTime(750));
    expect(s.editor.save).toHaveBeenCalledTimes(1);
    await act(async () => saving.reject(new Error('journal persistence failed')));
    expect(result.current.error).toBe('journal persistence failed');
  });

  it('honors a custom delay and cancels the timer when explicit save runs immediately', async () => {
    const s = makeEditor(); const b = makeBrowser(s.editor); jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result } = renderHook(() => useDataDocument(resource, { autoSaveDelayMs: 1_500 }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.edit({ content: 'mine' }); });
    await act(async () => jest.advanceTimersByTime(1_000)); expect(s.editor.save).not.toHaveBeenCalled();
    await act(async () => { await result.current.save(); }); expect(s.editor.save).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(1_500)); expect(s.editor.save).toHaveBeenCalledTimes(1);
  });

  // The late timer never fires for a screen that is gone; what it would have sent is handed to
  // the engine as the editor closes (BUG-20260919-engine-leaving-strands-last-edit).
  it.each(['owner', 'navigation', 'unmount'] as const)('cancels scheduled delivery on %s changes and hands the draft over on close', async change => {
    const s = makeEditor(); const first = makeBrowser(s.editor), second = makeBrowser();
    jest.mocked(createBrowserDataEngine).mockReturnValueOnce(first.browser).mockReturnValue(second.browser);
    const { result, rerender, unmount } = renderHook(({ id }) => useDataDocument({ ...resource, id }), { wrapper: Wrapper, initialProps: { id: 'note' } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.edit({ content: 'durable before leaving' }); });
    expect(s.editor.edit).toHaveBeenCalledTimes(1); expect(s.editor.save).not.toHaveBeenCalled();
    if (change === 'owner') { owner('other'); rerender({ id: 'note' }); }
    else if (change === 'navigation') { first.engine.openEditor.mockResolvedValueOnce(makeEditor().editor); rerender({ id: 'other' }); }
    else unmount();
    await act(async () => jest.advanceTimersByTime(1_000));
    expect(s.editor.save).not.toHaveBeenCalled();
    expect(s.editor.close).toHaveBeenCalledWith({ flush: true });
  });

  it('requires the provider boundary', () => {
    const report = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useDataEngine())).toThrow('Mount DataEngineProvider'); report.mockRestore();
  });

  // A screen that also exists without the engine reads a collection the same way in both
  // deployments. No engine means no rows to show — an absence, not a programming error — while a
  // document editor keeps the strict boundary, where a missing provider really is a mistake.
  it('reports an absent engine as an empty collection rather than throwing', () => {
    const { result } = renderHook(() => useDataCollection('councils'));
    expect(result.current.state).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(createBrowserDataEngine).not.toHaveBeenCalled();
  });

  it('forwards explicit remove and cancels the pending autosave timer', async () => {
    const s = makeEditor(); const b = makeBrowser(s.editor); jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result } = renderHook(() => useDataDocument(resource), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ content: 'base' }));
    await act(async () => { await result.current.edit({ content: 'draft' }); });
    await act(async () => { await result.current.remove(); });
    expect(s.editor.remove).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(750)); expect(s.editor.save).not.toHaveBeenCalled();
  });
});

const collectionState = (snapshots: ResourceSnapshot[] = [snapshot()]): CollectionState => ({ snapshots, complete: true, freshness: 'server', checking: false, version: 1, error: null });

describe('React collection and explicit recovery APIs', () => {
  it('shows submitted local rows before an initial server list answers', async () => {
    const b = makeBrowser(); jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result } = renderHook(() => useDataCollection('studyNotes'), { wrapper: Wrapper });
    await waitFor(() => expect(b.collectionWatches).toHaveLength(1));
    await act(async () => b.collectionWatches[0].next({ ...collectionState([]), complete: false, freshness: 'unknown', documents: [{
      resource: snapshot().resource, value: snapshot().value, pending: true, needsAttention: false, deleting: false,
    }] }));
    expect(result.current.loading).toBe(false);
    expect(result.current.state?.complete).toBe(false);
    expect(result.current.state?.freshness).toBe('unknown');
  });
  beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); owner('owner'); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('subscribes to collection updates including remote deletion and never regresses them with an older refresh result', async () => {
    const b = makeBrowser(); jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result, unmount } = renderHook(() => useDataCollection('studyNotes'), { wrapper: Wrapper });
    await waitFor(() => expect(b.collectionWatches).toHaveLength(1));
    expect(result.current.loading).toBe(true);
    await act(async () => b.collectionWatches[0].next(collectionState()));
    expect(result.current.state?.snapshots[0].value).toEqual({ content: 'base' }); expect(result.current.loading).toBe(false);
    const refreshing = deferred<CollectionState>(); b.engine.refreshCollection.mockReturnValue(refreshing.promise);
    let refresh!: Promise<CollectionState>;
    await act(async () => { refresh = result.current.refresh(); });
    const deleted = collectionState([{ ...snapshot('base', 2), value: null, metadata: { ...snapshot().metadata!, revision: 2, deleted: true } }]);
    await act(async () => b.collectionWatches[0].next(deleted));
    await act(async () => { refreshing.resolve(collectionState()); await refresh; });
    expect(result.current.state).toEqual(deleted); expect(result.current.error).toBeNull();
    unmount(); expect(b.collectionWatches[0].stop).toHaveBeenCalledTimes(1);
  });

  it('fences collection A-to-B-to-A callbacks and late refresh failures, and disables a null collection', async () => {
    const b = makeBrowser(); jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result, rerender } = renderHook(({ name }: { name: string | null }) => useDataCollection(name), { wrapper: Wrapper, initialProps: { name: 'studyNotes' as string | null } });
    await waitFor(() => expect(b.collectionWatches).toHaveLength(1));
    const refreshing = deferred<CollectionState>(); b.engine.refreshCollection.mockReturnValueOnce(refreshing.promise);
    let stale!: Promise<CollectionState>;
    await act(async () => { stale = result.current.refresh(); void stale.catch(() => undefined); });
    rerender({ name: 'sermons' }); rerender({ name: 'studyNotes' });
    await waitFor(() => expect(b.collectionWatches).toHaveLength(3));
    await act(async () => { b.collectionWatches[0].next(collectionState([snapshot('stale')])); refreshing.reject(new Error('old failure')); await stale.catch(() => undefined); });
    expect(result.current.state).toBeNull(); expect(result.current.error).toBeNull();
    await act(async () => b.collectionWatches[2].next(collectionState([snapshot('fresh')])));
    expect(result.current.state?.snapshots[0].value?.content).toBe('fresh');
    rerender({ name: null }); expect(result.current.state).toBeNull(); expect(result.current.loading).toBe(false);
    await expect(result.current.refresh()).rejects.toThrow('active collection changed');
  });

  it('reports collection watch and refresh failures and fences callbacks after owner replacement', async () => {
    const first = makeBrowser(), second = makeBrowser(); first.engine.watchCollection.mockImplementationOnce(() => { throw new Error('watch unavailable'); });
    jest.mocked(createBrowserDataEngine).mockReturnValueOnce(first.browser).mockReturnValue(second.browser);
    const { result, rerender } = renderHook(() => useDataCollection('studyNotes'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.error).toBe('watch unavailable'));
    first.engine.refreshCollection.mockRejectedValueOnce(new Error('refresh unavailable'));
    await act(async () => { await result.current.refresh().catch(() => undefined); });
    expect(result.current.error).toBe('refresh unavailable');
    first.engine.refreshCollection.mockResolvedValueOnce(collectionState());
    await act(async () => { await result.current.refresh(); });
    expect(first.engine.watchCollection).toHaveBeenCalledTimes(2);
    await act(async () => first.collectionWatches[0].next(collectionState()));
    expect(result.current.error).toBeNull();
    owner('other'); rerender(); await waitFor(() => expect(second.collectionWatches).toHaveLength(1));
    expect(result.current.error).toBeNull();
    await act(async () => second.collectionWatches[0].next({ ...collectionState(), error: 'feed unavailable' }));
    expect(result.current.error).toBe('feed unavailable');
  });

  it('rejects superseded recovery actions even when navigation happens before their opening effect', async () => {
    const b = makeBrowser(); jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result, rerender } = renderHook(({ id }) => useDataDocument({ ...resource, id }, { autoSave: false }), { wrapper: Wrapper, initialProps: { id: 'note' } });
    await waitFor(() => expect(result.current.data).toEqual({ content: 'base' }));
    let first!: Promise<void>, second!: Promise<void>;
    await act(async () => {
      first = result.current.recover('first'); void first.catch(() => undefined);
      second = result.current.recover('second'); void second.catch(() => undefined);
      rerender({ id: 'other' });
    });
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(b.engine.recoverEditor).not.toHaveBeenCalled();
  });

  it('applies same-tick functional updates against the latest controller draft and persists each immediately', async () => {
    const s = makeEditor(); const b = makeBrowser(s.editor); jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result } = renderHook(() => useDataDocument(resource), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ content: 'base' }));
    await act(async () => {
      const update = result.current.update;
      const first = update(current => ({ ...current, content: `${current?.content} A` }));
      const second = update(current => ({ ...current, content: `${current?.content} B` }));
      expect(s.editor.edit).toHaveBeenCalledTimes(2);
      expect(s.state.checkpoint.draft?.content).toBe('base A B');
      await Promise.all([first, second]);
    });
    expect(result.current.data?.content).toBe('base A B'); expect(s.editor.save).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(750)); expect(s.editor.save).toHaveBeenCalledTimes(1);
  });

  it('rejects a captured update callback before touching an old account editor', async () => {
    const old = makeEditor(); const first = makeBrowser(old.editor), second = makeBrowser();
    jest.mocked(createBrowserDataEngine).mockReturnValueOnce(first.browser).mockReturnValue(second.browser);
    const { result, rerender } = renderHook(() => useDataDocument(resource, { autoSave: false }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ content: 'base' }));
    const staleUpdate = result.current.update;
    owner('other'); rerender(); await waitFor(() => expect(second.engine.openEditor).toHaveBeenCalledTimes(1));
    const updater = jest.fn(current => current);
    await expect(staleUpdate(updater)).rejects.toThrow('active editor changed');
    expect(updater).not.toHaveBeenCalled(); expect(old.editor.edit).not.toHaveBeenCalled();
  });

  it.each([false, true])('discovers without changing the open draft and explicitly recovers with normal autoSave=%s', async autoSave => {
    const old = makeEditor(), restored = makeEditor();
    restored.setState({ ...restored.state, checkpoint: { ...restored.state.checkpoint, draft: { content: 'recovered' }, dirty: true, editGeneration: 3 } });
    const b = makeBrowser(old.editor); b.engine.recoverEditor.mockResolvedValue(restored.editor);
    const recoveryRecord: RecoveryCheckpoint = { id: '["owner","previous-tab"]', record: { owner: 'owner', editorId: 'previous-tab', checkpoint: restored.state.checkpoint, prepared: null, unfinalized: [] } };
    b.engine.listRecoverable.mockResolvedValue([recoveryRecord]); jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result } = renderHook(() => useDataDocument(resource, { autoSave }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ content: 'base' }));
    expect(b.engine.listRecoverable).not.toHaveBeenCalled(); expect(b.engine.recoverEditor).not.toHaveBeenCalled();
    let listed!: RecoveryCheckpoint[];
    await act(async () => { listed = await result.current.listRecoverable(); });
    expect(listed).toEqual([recoveryRecord]); expect(result.current.data).toEqual({ content: 'base' });
    let recovering!: Promise<void>;
    await act(async () => { recovering = result.current.recover(listed[0].id); });
    await act(async () => recovering);
    expect(old.editor.close).toHaveBeenCalledWith({ flush: autoSave }); expect(old.editor.edit).not.toHaveBeenCalled();
    expect(result.current.data).toEqual({ content: 'recovered' });
    expect(b.engine.recoverEditor).toHaveBeenCalledWith(resource, expect.stringContaining(':recovery:'), recoveryRecord.id, { signal: expect.any(AbortSignal) });
    await act(async () => jest.advanceTimersByTime(750)); expect(restored.editor.save).toHaveBeenCalledTimes(autoSave ? 1 : 0);
  });

  it('queues a recovered successor once while retaining the unknown predecessor', async () => {
    const old = makeEditor(), restored = makeEditor();
    restored.setState({ ...restored.state, checkpoint: { ...restored.state.checkpoint, draft: { content: 'B' }, dirty: true, editGeneration: 2, pending: { original: { generation: 1, value: { content: 'A' } } } } });
    const b = makeBrowser(old.editor); b.engine.recoverEditor.mockResolvedValue(restored.editor); jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result } = renderHook(() => useDataDocument(resource), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ content: 'base' }));
    let recovering!: Promise<void>; await act(async () => { recovering = result.current.recover('["owner","old"]'); }); await act(async () => recovering);
    await act(async () => jest.advanceTimersByTime(2_000)); expect(restored.editor.save).toHaveBeenCalledTimes(1);
    expect(restored.state.checkpoint.pending.original.value).toEqual({ content: 'A' });
    expect(restored.state.checkpoint.pending['op-1'].value).toEqual({ content: 'B' });
    await act(async () => restored.setState({ ...restored.state, checkpoint: { ...restored.state.checkpoint, confirmed: snapshot('A', 2), pending: { 'op-1': restored.state.checkpoint.pending['op-1'] } } }));
    await act(async () => jest.advanceTimersByTime(750)); expect(restored.editor.save).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual({ content: 'B' });
  });

  it('aborts recovery on navigation, disposes its late result and never reactivates it after A-to-B-to-A', async () => {
    const old = makeEditor(), late = makeEditor(), fresh = makeEditor();
    const b = makeBrowser(old.editor); const pending = deferred<ManagedEditor>(); b.engine.recoverEditor.mockReturnValueOnce(pending.promise);
    jest.mocked(createBrowserDataEngine).mockReturnValue(b.browser);
    const { result, rerender } = renderHook(({ id }) => useDataDocument({ ...resource, id }, { autoSave: false }), { wrapper: Wrapper, initialProps: { id: 'note' } });
    await waitFor(() => expect(result.current.data).toEqual({ content: 'base' }));
    let recovering!: Promise<void>; await act(async () => { recovering = result.current.recover('source'); void recovering.catch(() => undefined); });
    const signal = b.engine.recoverEditor.mock.calls[0][3]?.signal;
    b.engine.openEditor.mockResolvedValue(fresh.editor); rerender({ id: 'other' }); rerender({ id: 'note' });
    await act(async () => recovering.catch(() => undefined)); expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(late.editor));
    expect(late.editor.dispose).toHaveBeenCalledTimes(1); expect(b.engine.recoverEditor).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual({ content: 'base' }); expect(result.current.error).toBeNull();
  });

  it('uses fresh IDs on repeated recovery, retries errors, and fences old-owner discovery results', async () => {
    const first = makeBrowser(), second = makeBrowser(); first.engine.recoverEditor.mockRejectedValueOnce(new Error('disk unavailable'));
    jest.mocked(createBrowserDataEngine).mockReturnValueOnce(first.browser).mockReturnValue(second.browser);
    const { result, rerender } = renderHook(() => useDataDocument(resource, { autoSave: false }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ content: 'base' }));
    let recovering!: Promise<void>; await act(async () => { recovering = result.current.recover('source'); void recovering.catch(() => undefined); });
    await act(async () => recovering.catch(() => undefined)); expect(result.current.error).toBe('disk unavailable');
    let retry!: Promise<void>; await act(async () => { retry = result.current.retry(); }); await act(async () => retry);
    expect(result.current.error).toBeNull();
    expect(first.engine.recoverEditor.mock.calls[0][1]).not.toBe(first.engine.recoverEditor.mock.calls[1][1]);
    const listing = deferred<RecoveryCheckpoint[]>(); first.engine.listRecoverable.mockReturnValueOnce(listing.promise);
    let oldList!: Promise<RecoveryCheckpoint[]>; await act(async () => { oldList = result.current.listRecoverable(); void oldList.catch(() => undefined); });
    owner('other'); rerender(); await waitFor(() => expect(second.engine.openEditor).toHaveBeenCalledTimes(1));
    await act(async () => { listing.resolve([]); await oldList.catch(() => undefined); });
    await expect(oldList).rejects.toThrow('active editor changed'); expect(result.current.error).toBeNull();
  });
});
