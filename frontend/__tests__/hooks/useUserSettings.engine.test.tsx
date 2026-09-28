import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataDocumentProvider, DataEngineProvider } from '@/data-engine/react.client';
import { useUserSettings, useUserSettingsQuery } from '@/hooks/useUserSettings';
import { useSettingsEngine } from '@/hooks/userSettingsEngineContext';
import { useAuth } from '@/providers/AuthProvider';
import { UserSettingsProvider } from '@/providers/UserSettingsProvider';
import * as service from '@/services/userSettings.service';
import { awaitSettingsWrite } from '@/utils/settingsWrite';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/services/userSettings.service', () => ({
  getUserSettings: jest.fn(), setLanguageCookie: jest.fn(),
  updatePrepModeAccess: jest.fn(), updateAudioGenerationAccess: jest.fn(),
  updateStructurePreviewAccess: jest.fn(), updateShowAppVersion: jest.fn(),
  updateFirstDayOfWeek: jest.fn(), updateModelPreference: jest.fn(),
  updateFunctionModelPreference: jest.fn(),
}));

const resource = { collection: 'users', id: 'owner' };
const initial = { userId: 'owner', language: 'en', firstDayOfWeek: 'sunday', enablePrepMode: false,
  enableAudioGeneration: false, enableStructurePreview: false, showAppVersion: false };
const originalEnabled = process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
const originalCollections = process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
const clients: QueryClient[] = [];
function owner(uid: string | null) {
  jest.mocked(useAuth).mockReturnValue({ user: uid ? { uid } : null, loading: false, isAuthenticated: Boolean(uid) } as ReturnType<typeof useAuth>);
}
function setup(missing = false) {
  const harness = documentEngineHarness({ resource, value: missing ? null : initial,
    metadata: missing ? null : { protocol: 1, generation: 'settings', revision: 1, deleted: false } });
  const openings: jest.SpyInstance[] = [];
  jest.mocked(createBrowserDataEngine).mockImplementation(() => {
    const browser = harness.createBrowser();
    openings.push(jest.spyOn(browser.engine, 'openEditor'));
    return browser;
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(queryClient);
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={queryClient}>
    <DataEngineProvider><UserSettingsProvider>{children}</UserSettingsProvider></DataEngineProvider>
  </QueryClientProvider>;
  const mount = () => renderHook(() => ({ settings: useUserSettings('owner'), feature: useUserSettingsQuery('owner'),
    second: useUserSettings('owner'), source: useSettingsEngine() }), { wrapper });
  return { harness, wrapper, mount, openings };
}
beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
  process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'users';
  owner('owner');
  jest.mocked(service.getUserSettings).mockImplementation(() => new Promise(() => undefined));
});
afterEach(() => {
  clients.splice(0).forEach(client => client.clear());
  if (originalEnabled === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
  else process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED = originalEnabled;
  if (originalCollections === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
  else process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = originalCollections;
});

describe('settings through the shared real DataEngine', () => {
  it('loads by engine transport while legacy SDK read stays silent (negative control included)', async () => {
    process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = '';
    const legacy = setup();
    const old = legacy.mount();
    await act(settleEngine);
    expect(service.getUserSettings).toHaveBeenCalledWith('owner');
    expect(old.result.current.settings.loading).toBe(true);
    expect(old.result.current.settings.settings).toBeNull();
    old.unmount();
    process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'users';
    jest.mocked(service.getUserSettings).mockClear();
    const migrated = setup();
    migrated.harness.silentRemote({ firstDayOfWeek: 'monday' });
    const current = migrated.mount();
    await waitFor(() => expect(current.result.current.settings.loading).toBe(false));
    await waitFor(() => expect(current.result.current.settings.settings?.firstDayOfWeek).toBe('monday'));
    expect(current.result.current.feature.data?.firstDayOfWeek).toBe('monday');
    expect(current.result.current.source?.document.confirmed?.metadata?.revision).toBe(2);
    expect(service.getUserSettings).not.toHaveBeenCalled();
    await waitFor(() => expect(migrated.harness.transport.read).toHaveBeenCalled());
    expect(migrated.openings.flatMap(open => open.mock.calls).filter(([ref]) => ref.collection === 'users')).toHaveLength(1);
  });

  it('shares one settings editor with readers inside an unrelated document provider', async () => {
    const context = setup();
    const unrelated = { collection: 'sermons', id: 'sermon' };
    const read = jest.mocked(context.harness.transport.read).getMockImplementation()!;
    jest.mocked(context.harness.transport.read).mockImplementation(async (uid, ref) => ref.collection === 'users'
      ? read(uid, ref)
      : { resource: ref, value: { userId: uid, title: 'Unrelated sermon' }, metadata: { protocol: 1, generation: 'sermon', revision: 1, deleted: false } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <context.wrapper>
      <DataDocumentProvider resource={unrelated}>{children}</DataDocumentProvider>
    </context.wrapper>;
    const hook = renderHook(() => ({ editor: useUserSettings('owner'), feature: useUserSettingsQuery('owner'), second: useUserSettings('owner') }), { wrapper });
    await waitFor(() => expect(hook.result.current.editor.readOnly).toBe(false));
    await act(async () => { await awaitSettingsWrite(hook.result.current.editor.updatePrepModeAccess(true), jest.fn()); });
    expect(hook.result.current.feature.data?.enablePrepMode).toBe(true);
    expect(hook.result.current.second.settings?.enablePrepMode).toBe(true);
    await waitFor(() => expect(context.harness.server.value?.enablePrepMode).toBe(true));
    expect(context.openings.flatMap(open => open.mock.calls).filter(([ref]) => ref.collection === 'users')).toHaveLength(1);
    expect(service.updatePrepModeAccess).not.toHaveBeenCalled();
  });

  it('keeps an accepted offline change after closing and reopening the entire workspace', async () => {
    const context = setup();
    const first = context.mount();
    await waitFor(() => expect(first.result.current.settings.readOnly).toBe(false));
    const send = jest.mocked(context.harness.transport.send), deliver = send.getMockImplementation()!;
    send.mockImplementation(async () => { throw Object.assign(new TypeError('Offline'), { code: 'unavailable' }); });
    await act(async () => { await awaitSettingsWrite(first.result.current.settings.updateFirstDayOfWeek('monday'), jest.fn()); await settleEngine(); });
    expect(first.result.current.settings.settings?.firstDayOfWeek).toBe('monday');
    expect(context.harness.server.value?.firstDayOfWeek).toBe('sunday');
    first.unmount();
    const reopened = context.mount();
    await waitFor(() => expect(reopened.result.current.settings.settings?.firstDayOfWeek).toBe('monday'));
    expect(context.harness.server.value?.firstDayOfWeek).toBe('sunday');
    send.mockImplementation(deliver);
    await act(async () => { await reopened.result.current.settings.refresh(); await settleEngine(); });
    await waitFor(() => expect(context.harness.server.value?.firstDayOfWeek).toBe('monday'));
  });

  it('merges an independent remote preference without overwriting it', async () => {
    const context = setup(), hook = context.mount();
    await waitFor(() => expect(hook.result.current.settings.readOnly).toBe(false));
    context.harness.silentRemote({ enableAudioGeneration: true });
    await act(async () => { await awaitSettingsWrite(hook.result.current.settings.updateFirstDayOfWeek('monday'), jest.fn()); await settleEngine(); });
    await waitFor(() => expect(context.harness.server.value).toMatchObject({ enableAudioGeneration: true, firstDayOfWeek: 'monday' }));
    expect(hook.result.current.settings.settings).toMatchObject({ enableAudioGeneration: true, firstDayOfWeek: 'monday' });
  });

  it('keeps competing values for the same field visible until the user chooses', async () => {
    const context = setup(), hook = context.mount();
    await waitFor(() => expect(hook.result.current.settings.readOnly).toBe(false));
    context.harness.silentRemote({ preferredModelId: 'remote-model' });
    await act(async () => { await awaitSettingsWrite(hook.result.current.settings.updateModelPreference({ preferredProviderId: 'openai', preferredModelId: 'local-model' }), jest.fn()); await settleEngine(); });
    await waitFor(() => expect(hook.result.current.source?.document.status?.phase).toBe('conflict'));
    expect(context.harness.server.value?.preferredModelId).toBe('remote-model');
    expect(hook.result.current.settings.settings?.preferredModelId).toBe('local-model');
    await act(async () => { await hook.result.current.source!.document.acceptRemote(); await settleEngine(); });
    await waitFor(() => expect(hook.result.current.settings.settings?.preferredModelId).toBe('remote-model'));
  });

  it('fences foreign readers and stale actions after the authenticated account changes', async () => {
    const context = setup();
    const hook = renderHook(({ uid }) => useUserSettings(uid), { wrapper: context.wrapper, initialProps: { uid: 'owner' } });
    await waitFor(() => expect(hook.result.current.readOnly).toBe(false));
    const oldAction = hook.result.current.updatePrepModeAccess;
    hook.rerender({ uid: 'someone-else' });
    expect(hook.result.current.settings).toBeNull();
    await expect(awaitSettingsWrite(hook.result.current.updatePrepModeAccess(true), jest.fn())).rejects.toThrow('not ready');
    owner(null);
    hook.rerender({ uid: 'owner' });
    await expect(awaitSettingsWrite(oldAction(true), jest.fn())).rejects.toThrow();
    expect(hook.result.current.settings).toBeNull();
    expect(context.harness.transport.send).not.toHaveBeenCalled();
  });

  it('rejects local storage failure instead of acknowledging or sending the change', async () => {
    const context = setup(), hook = context.mount();
    await waitFor(() => expect(hook.result.current.settings.readOnly).toBe(false));
    jest.spyOn(context.harness.commits, 'create').mockRejectedValue(new Error('disk full'));
    let error: unknown;
    await act(async () => {
      try { await awaitSettingsWrite(hook.result.current.settings.updatePrepModeAccess(true), jest.fn()); }
      catch (failure) { error = failure; }
      await settleEngine();
    });
    expect(error).toEqual(expect.objectContaining({ message: 'disk full' }));
    expect(context.harness.server.value?.enablePrepMode).toBe(false);
    expect(context.harness.transport.send).not.toHaveBeenCalled();
    expect(hook.result.current.source?.document.error).toBeTruthy();
  });

  it('does not report acceptance while durable submission is still pending', async () => {
    const context = setup(), hook = context.mount();
    await waitFor(() => expect(hook.result.current.settings.readOnly).toBe(false));
    const persist = context.harness.commits.create.bind(context.harness.commits);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    jest.spyOn(context.harness.commits, 'create').mockImplementation(async request => {
      await pending;
      return persist(request);
    });
    let accepted = false, submission!: Promise<void>;
    await act(async () => {
      submission = awaitSettingsWrite(hook.result.current.settings.updatePrepModeAccess(true), jest.fn()).then(() => { accepted = true; });
      await settleEngine();
    });
    expect(hook.result.current.settings.settings?.enablePrepMode).toBe(true);
    expect(accepted).toBe(false);
    expect(context.harness.transport.send).not.toHaveBeenCalled();
    await act(async () => { release(); await submission; await settleEngine(); });
    expect(accepted).toBe(true);
    await waitFor(() => expect(context.harness.server.value?.enablePrepMode).toBe(true));
  });

  it('creates a missing owner document using only the requested preference', async () => {
    const context = setup(true), hook = context.mount();
    await waitFor(() => expect(hook.result.current.settings.readOnly).toBe(false));
    expect(hook.result.current.settings.settings).toBeNull();
    await act(async () => { await awaitSettingsWrite(hook.result.current.settings.updateFirstDayOfWeek('monday'), jest.fn()); await settleEngine(); });
    await waitFor(() => expect(context.harness.server.value).toEqual({ firstDayOfWeek: 'monday' }));
  });
});
