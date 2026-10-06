import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import { createBrowserDataEngine, type BrowserDataEngine } from '@/data-engine/browser.client';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { captureMembershipPins } from '@/data-engine/membershipCapture';
import { DataSession } from '@/data-engine/session';
import { preparePreachDate } from '@/components/calendar/preachDateForm';
import { DataEngineProvider, useDataCollection, useDataDocument } from '@/data-engine/react.client';
import { useRecoveryDiscovery } from '@/data-engine/useRecoveryDiscovery';
import { actionFailureMessage, failureWords, fillRequiredField, fillRequiredFieldError, readOnlyError, refusalMessage, refusalWords, saidError, sayFailure } from '@/utils/actionFailureMessage';
import { storageSilentError } from '@/utils/deviceStorage';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';
import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';

import type { CollectionState } from '@/data-engine/collections';
import type { SyncStatus } from '@/data-engine/status';

/**
 * WHAT THE PERSON READS WHEN THE ENGINE FAILS (BUG-20261003-engine-error-sentence-on-screen).
 *
 * The engine's errors are sentences for developers ("The document is not available in the local
 * cache"), and the sermon screen printed one under its own translated "could not load". The hooks
 * now keep the words of a failure where they catch it and translate them when they render. A failed
 * read says the hook's line, and the original goes to the console once; a refused action keeps the
 * engine's sentence, which may be an instruction ("Read the current document before resolving a
 * generation mismatch"), as it did before. Either way a refusal already written for the person keeps
 * its words, and a cause the person can act on is said by its code. The status panel prints whatever
 * words it is given.
 */
let language = 'ru';
// Each `t` speaks the language it was handed out in, as i18next's does after a switch: a hook that
// kept an old `t`, or kept a translated string, keeps saying the old language.
jest.mock('react-i18next', () => ({ useTranslation: () => { const spoken = language; return { t: (key: string) => `${spoken}:${key}` }; } }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const ENGINE_SENTENCE = 'The document is not available in the local cache';
const status = { phase: 'saved', freshness: 'server', checking: false, readFailed: false, hasForeignChange: false,
  canSave: false, canRemove: false, canAcceptRemote: false, canKeepLocal: false } as SyncStatus;
const wrapper = ({ children }: { children: React.ReactNode }) => <DataEngineProvider>{children}</DataEngineProvider>;
const t = (key: string) => `${language}:${key}`;

let logged: jest.SpyInstance;
beforeEach(() => { language = 'ru'; logged = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { logged.mockRestore(); jest.mocked(createBrowserDataEngine).mockReset(); });

/** An open editor the test can drive: a confirmed document and an error in its own state. */
function fakeEditor(resource: { collection: string; id: string }) {
  let state = { durable: true, error: null as string | null, result: null,
    checkpoint: { confirmed: { resource, value: { title: 'Grace' }, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } },
      draft: { title: 'Grace' }, dirty: false, editGeneration: 0, pending: {}, conflicts: [], remoteCandidate: null } };
  const listeners = new Set<() => void>();
  const editor = { getState: () => state, getDelivery: () => [],
    getObservation: () => ({ snapshot: state.checkpoint.confirmed, source: 'server', readiness: 'server', checking: false, error: false }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, close: jest.fn(), dispose: jest.fn() };
  return { editor, setError: (error: string) => { state = { ...state, error }; listeners.forEach(listener => listener()); } };
}

function Screen({ id }: { id: string }) {
  const document = useDataDocument({ collection: 'sermons', id });
  return <DataSyncStatus subject={document.recoveryIdentity} status={document.status} error={document.error} onRetry={document.retry} />;
}

describe('a failure is said in words where it is caught', () => {
  it('a document the device does not have, opened offline, says the screen line, re-says it in a new language, and logs once', async () => {
    const opening = new Error(ENGINE_SENTENCE);
    const engine = { setOwner: jest.fn(), openEditor: jest.fn(async () => { throw opening; }) };
    jest.mocked(createBrowserDataEngine).mockReturnValue({ engine, dispose: jest.fn(), editorId: () => 'editor' } as unknown as BrowserDataEngine);
    const view = render(<Screen id="sermon-elsewhere" />, { wrapper });
    expect(await screen.findByRole('alert')).toHaveTextContent('ru:dataSync.documentFailed');
    expect(screen.queryByText(new RegExp(ENGINE_SENTENCE))).toBeNull();
    language = 'uk';
    view.rerender(<Screen id="sermon-elsewhere" />);
    expect(screen.getByRole('alert')).toHaveTextContent('uk:dataSync.documentFailed');
    expect(logged.mock.calls.filter(([value]) => value === opening)).toHaveLength(1);
  });

  describe('a change refused by the screen itself', () => {
    const resource = { collection: 'sermons', id: 'sermon-1' };
    const stored = { userId: 'owner', title: 'Grace', verse: 'John 1:14' };
    const open = async () => {
      const harness = documentEngineHarness({ resource, value: stored, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
      jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
      const hook = renderHook(() => useDataDocument(resource, { autoSave: false }), { wrapper });
      await waitFor(() => expect(hook.result.current.status).not.toBeNull());
      return hook;
    };

    /** BUG-20261003-said-refusal-keeps-old-language */
    it('says the words the screen wrote for the person in the current language, after a switch too', async () => {
      const { result, rerender, unmount } = await open();
      await act(async () => { await result.current.commit(() => { throw saidError('common.fillRequiredField', { field: { key: 'workspaces.groups.form.title' } }); }).catch(() => undefined); await settleEngine(); });
      expect(result.current.error).toBe('ru:common.fillRequiredField');
      language = 'en';
      rerender();
      expect(result.current.error).toBe('en:common.fillRequiredField');
      unmount();
    });

    it('keeps the engine sentence of a refused action, which may be an instruction', async () => {
      const { result, unmount } = await open();
      const instruction = 'The selected preach date is no longer available';
      await act(async () => { await result.current.commit(() => { throw new Error(instruction); }).catch(() => undefined); await settleEngine(); });
      expect(result.current.error).toBe(instruction);
      unmount();
    });

    it('says a refused action by its code when the person can act on it, in the current language', async () => {
      const { result, rerender, unmount } = await open();
      await act(async () => { await result.current.commit(() => { throw Object.assign(new Error('Remote document was deleted'), { code: 'use-new-copy' }); }).catch(() => undefined); await settleEngine(); });
      expect(result.current.error).toBe('ru:dataSync.failure.deleted');
      language = 'en';
      rerender();
      expect(result.current.error).toBe('en:dataSync.failure.deleted');
      unmount();
    });
  });

  it('recovering a draft that is gone keeps its explanation: recovery is the person\'s action', async () => {
    const resource = { collection: 'sermons', id: 'sermon-1' };
    const gone = new Error('Recovery checkpoint no longer exists');
    const { editor } = fakeEditor(resource);
    const engine = { setOwner: jest.fn(), openEditor: jest.fn(async () => editor), recoverEditor: jest.fn(async () => { throw gone; }) };
    jest.mocked(createBrowserDataEngine).mockReturnValue({ engine, dispose: jest.fn(), editorId: () => 'editor' } as unknown as BrowserDataEngine);
    const { result, unmount } = renderHook(() => useDataDocument(resource, { autoSave: false }), { wrapper });
    await waitFor(() => expect(result.current.status).not.toBeNull());
    // Started in one act and awaited in the next: the recovery opens only after React renders the request.
    let recovering!: Promise<unknown>;
    act(() => { recovering = result.current.recover('checkpoint-that-is-gone').catch(() => undefined); });
    await act(async () => { await recovering; });
    await waitFor(() => expect(result.current.error).toBe('Recovery checkpoint no longer exists'));
    unmount();
  });

  it('the editor state keeps a refused action in the engine words, as before', async () => {
    const resource = { collection: 'sermons', id: 'sermon-1' };
    const instruction = 'Read the current document before resolving a generation mismatch';
    const fake = fakeEditor(resource);
    const engine = { setOwner: jest.fn(), openEditor: jest.fn(async () => fake.editor) };
    jest.mocked(createBrowserDataEngine).mockReturnValue({ engine, dispose: jest.fn(), editorId: () => 'editor' } as unknown as BrowserDataEngine);
    const { result, unmount } = renderHook(() => useDataDocument(resource, { autoSave: false }), { wrapper });
    await waitFor(() => expect(result.current.status).not.toBeNull());
    act(() => { fake.setError(instruction); });
    expect(result.current.error).toBe(instruction);
    unmount();
  });

  it('a draft search keeps the storage explanation in the current language and says the screen line otherwise', async () => {
    const list = jest.fn().mockRejectedValueOnce(storageSilentError())
      .mockRejectedValueOnce(new Error('IDBDatabase transaction aborted'));
    const identity = {};
    const hook = renderHook(() => useRecoveryDiscovery({ identity, enabled: true, version: '1', list, recover: jest.fn() }));
    // The default message of a silent-storage error is English; the code is what is said.
    await waitFor(() => expect(hook.result.current.error).toBe('ru:dataSync.readOnly.storage'));
    await act(async () => { await hook.result.current.refresh(); });
    expect(hook.result.current.error).toBe('ru:dataSync.documentFailed');
  });

  it('a draft search failure reaches the console once under StrictMode', async () => {
    const failure = new Error('IDBDatabase transaction aborted');
    const identity = {};
    const hook = renderHook(() => useRecoveryDiscovery({ identity, enabled: true, version: '1', list: jest.fn().mockRejectedValue(failure), recover: jest.fn() }),
      { wrapper: React.StrictMode });
    await waitFor(() => expect(hook.result.current.error).toBe('ru:dataSync.documentFailed'));
    expect(logged.mock.calls.filter(([value]) => value === failure)).toHaveLength(1);
  });

  it('a list failure the engine also reported in the background reaches the console once', async () => {
    const failure = new Error('Data engine unavailable');
    let report: ((error: unknown) => void) | undefined;
    const engine = { setOwner: jest.fn(), watchCollection: jest.fn(() => () => undefined),
      refreshCollection: jest.fn(async () => { report?.(failure); throw failure; }) };
    jest.mocked(createBrowserDataEngine).mockImplementation(options => {
      report = options?.onError;
      return { engine, dispose: jest.fn(), editorId: () => 'editor' } as unknown as BrowserDataEngine;
    });
    const { result, unmount } = renderHook(() => useDataCollection('sermons'), { wrapper });
    await waitFor(() => expect(engine.watchCollection).toHaveBeenCalled());
    await act(async () => { await result.current.refresh().catch(() => undefined); });
    expect(result.current.error).toBe('ru:dataSync.backgroundFailure');
    expect(logged.mock.calls.filter(call => call.includes(failure))).toHaveLength(1);
    unmount();
  });

  it('membership names what the person can do about its prerequisites', () => {
    let refusal: unknown;
    try { captureMembershipPins('owner', { complete: false, snapshots: [] } as unknown as CollectionState, []); } catch (error) { refusal = error; }
    expect(failureWords(refusal, 'dataSync.documentFailed')).toEqual({ key: 'dataSync.failure.seriesListIncomplete' });
    expect(logged).not.toHaveBeenCalled();
  });
});

describe('the status panel prints the words it is given', () => {
  it.each([
    ['the instruction for a form without its opening version', en.dataSync.missingOpeningVersion],
    ['the explanation of silent device storage', en.dataSync.readOnly.storage],
    ['an unaddressed background failure', en.dataSync.backgroundFailure],
  ])('%s', (_name, words) => {
    render(<DataSyncStatus subject="doc" status={null} error={words} />);
    expect(screen.getByRole('alert')).toHaveTextContent(words);
  });

  it('the storage explanation from a draft search', () => {
    render(<DataSyncStatus subject="doc" status={null} recoveryError={en.dataSync.readOnly.storage} />);
    expect(screen.getByRole('alert')).toHaveTextContent(en.dataSync.readOnly.storage);
  });

  it('keeps the instruction of a refused choice', async () => {
    const instruction = 'Read the current document before resolving a generation mismatch';
    render(<DataSyncStatus subject="doc" status={{ ...status, phase: 'refused', canKeepLocal: true }} onKeepLocal={() => { throw new Error(instruction); }} />);
    await act(async () => { fireEvent.click(screen.getByText('ru:dataSync.keepLocal')); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole('alert')).toHaveTextContent(instruction);
  });

  it('says the action line for a choice that failed without words, in the current language', async () => {
    const keep = () => { throw 'rejected'; };
    const view = render(<DataSyncStatus subject="doc" status={{ ...status, phase: 'refused', canKeepLocal: true }} onKeepLocal={keep} />);
    await act(async () => { fireEvent.click(screen.getByText('ru:dataSync.keepLocal')); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole('alert')).toHaveTextContent('ru:dataSync.actionFailed');
    language = 'en';
    view.rerender(<DataSyncStatus subject="doc" status={{ ...status, phase: 'refused', canKeepLocal: true }} onKeepLocal={keep} />);
    expect(screen.getByRole('alert')).toHaveTextContent('en:dataSync.actionFailed');
  });

  it('keeps a read-only refusal from a choice', async () => {
    const refusal = Object.assign(new Error('Память устройства не отвечает'), { code: 'read-only' });
    render(<DataSyncStatus subject="doc" status={{ ...status, phase: 'refused', canKeepLocal: true }} onKeepLocal={() => { throw refusal; }} />);
    await act(async () => { fireEvent.click(screen.getByText('ru:dataSync.keepLocal')); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole('alert')).toHaveTextContent('Память устройства не отвечает');
  });
});

/** BUG-20261003-said-refusal-keeps-old-language: what the screen says is kept as keys and said when shown. */
describe('a refusal the screen says itself', () => {
  const spoken = (key: string, values?: Record<string, string>) => `${language}:${key}${values ? JSON.stringify(values) : ''}`;

  it('is said again in the new language, the field name too', () => {
    const words = refusalWords(fillRequiredFieldError('workspaces.groups.form.title'), 'fallback');
    expect(sayFailure(words, spoken)).toBe('ru:common.fillRequiredField{"field":"ru:workspaces.groups.form.title"}');
    language = 'en';
    expect(sayFailure(words, spoken)).toBe('en:common.fillRequiredField{"field":"en:workspaces.groups.form.title"}');
    expect(sayFailure(fillRequiredField('workspaces.series.form.title'), spoken)).toBe('en:common.fillRequiredField{"field":"en:workspaces.series.form.title"}');
    expect(logged).not.toHaveBeenCalled();
  });

  it('says a read-only refusal by its reason, in the current language', () => {
    const words = failureWords(readOnlyError('dataSync.readOnly.storage'), 'fallback');
    expect(sayFailure(words, spoken)).toBe('ru:dataSync.readOnly.storage');
    language = 'uk';
    expect(sayFailure(words, spoken)).toBe('uk:dataSync.readOnly.storage');
  });
});

describe('failureWords', () => {
  it.each([
    ['a read-only refusal written as a sentence', Object.assign(new Error('Только просмотр'), { code: 'read-only' })],
  ])('keeps %s without logging it', (_name, error) => {
    expect(actionFailureMessage(error, t, 'fallback')).toBe(error.message);
    expect(logged).not.toHaveBeenCalled();
  });

  it.each([
    ['silent device storage', 'storage-silent', 'dataSync.readOnly.storage'],
    ['a deleted record', 'use-new-copy', 'dataSync.failure.deleted'],
    ['an incomplete series list', 'series-list-incomplete', 'dataSync.failure.seriesListIncomplete'],
    ['unsettled series changes', 'series-changes-pending', 'dataSync.failure.seriesChangesPending'],
  ])('says %s by its code', (_name, code, key) => {
    expect(failureWords(Object.assign(new Error('English for developers'), { code }), 'fallback')).toEqual({ key });
    expect(logged).not.toHaveBeenCalled();
  });

  /** BUG-20261003-engine-refusals-speak-english: a refusal that is an instruction is said in the interface language. */
  const instructions = [
    ['preach-date-gone', 'dataSync.failure.preachDateGone'],
    ['fresh-read-required', 'dataSync.failure.freshReadRequired'],
    ['resolve-version-first', 'dataSync.failure.resolveVersionFirst'],
    ['unsent-form-first', 'dataSync.failure.unsentFormFirst'],
    ['not-on-device-yet', 'dataSync.failure.notOnDeviceYet'],
    ['pending-delivery-first', 'dataSync.failure.pendingDeliveryFirst'],
    ['other-changes-first', 'dataSync.failure.otherChangesFirst'],
    ['draft-gone', 'dataSync.failure.draftGone'],
    ['draft-done', 'dataSync.failure.draftDone'],
    ['part-gone', 'dataSync.failure.partGone'],
  ] as const;
  it.each(instructions)('says the refusal %s by its code, in every language', (code, key) => {
    expect(refusalWords(Object.assign(new Error('English for developers'), { code }), 'fallback')).toEqual({ key });
    const path = key.split('.');
    for (const locale of [en, ru, uk]) {
      const words = path.reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], locale);
      expect(typeof words === 'string' && words.trim()).toBeTruthy();
    }
  });

  it('gives a vanished preach date and a choice over unsent changes their codes where they are refused', () => {
    const sermon = { userId: 'owner', title: 'T', preachDates: [] };
    const row = { id: 'gone', date: '2026-10-01', status: 'planned', createdAt: 'now', church: { id: 'c', name: 'C', city: '' } };
    expect(() => preparePreachDate(sermon as never, { kind: 'edit', dateId: 'gone' } as never, row as never)).toThrow(expect.objectContaining({ code: 'preach-date-gone' }));
    const session = new DataSession({ resource: { collection: 'sermons', id: 's' }, value: { title: 'A' }, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } });
    session.edit({ title: 'B' }); session.registerCommit('op', 1, { title: 'B' });
    expect(() => session.acceptRemote()).toThrow(expect.objectContaining({ code: 'pending-delivery-first' }));
    expect(() => session.keepLocal()).toThrow(expect.objectContaining({ code: 'pending-delivery-first' }));
  });

  it('keeps the sentence of a refused action unless it is coded or already for the person', () => {
    expect(refusalWords(new Error('Resolve the requested series before saving'), 'fallback')).toEqual({ said: 'Resolve the requested series before saving' });
    expect(refusalWords(storageSilentError(), 'fallback')).toEqual({ key: 'dataSync.readOnly.storage' });
    expect(refusalMessage(saidError('common.fillRequiredField'), t, 'fallback')).toBe('ru:common.fillRequiredField');
    expect(refusalMessage('rejected', t, 'fallback')).toBe('ru:fallback');
    expect(logged.mock.calls.filter(([value]) => value === 'rejected')).toHaveLength(1);
  });

  it('says an AI call cut by its time ceiling in words on both paths', () => {
    const cut = Object.assign(new Error('Compose failed with status 504'), { status: 504 });
    expect(refusalWords(cut, 'fallback')).toEqual({ key: 'errors.aiOutOfTime' });
    expect(failureWords(cut, 'fallback')).toEqual({ key: 'errors.aiOutOfTime' });
    expect(refusalWords(Object.assign(new Error('Server busy'), { status: 503 }), 'fallback')).toEqual({ said: 'Server busy' });
  });

  it('reads only its own codes, never the prototype', () => {
    expect(failureWords(Object.assign(new Error('x'), { code: 'constructor' }), 'fallback')).toEqual({ key: 'fallback' });
  });

  it('says the fallback for any other failure and logs each original once', () => {
    const failure = new Error(ENGINE_SENTENCE);
    expect(actionFailureMessage(failure, t, 'fallback')).toBe('ru:fallback');
    expect(actionFailureMessage(failure, t, 'fallback')).toBe('ru:fallback');
    expect(actionFailureMessage('not an error', t, 'fallback')).toBe('ru:fallback');
    expect(actionFailureMessage(saidError(''), t, 'fallback')).toBe('ru:fallback');
    expect(logged.mock.calls.filter(([value]) => value === failure)).toHaveLength(1);
  });
});
