import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { OfflineBanner } from '@/components/OfflineBanner';
import { STATUS_SETTLE_MS } from '@/hooks/useLasting';
import { ServerUnavailableNoticeProvider } from '@/providers/ServerUnavailableNoticeProvider';
import { ConnectionProvider } from '@/providers/ConnectionProvider';
import { failureWords } from '@/utils/actionFailureMessage';
import { createBrowserDataEngine, type BrowserDataEngine } from '@/data-engine/browser.client';
import { DataCollectionStatus } from '@/data-engine/DataCollectionStatus';
import type { CollectionState } from '@/data-engine/collections';
import type { SyncStatus } from '@/data-engine/status';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { DataEngineProvider, useDataCollection, useDataDocument, useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { useSettingsEngine } from '@/hooks/userSettingsEngineContext';
import { UserSettingsProvider, UserSettingsSyncStatus } from '@/providers/UserSettingsProvider';
import { resetDeviceStorageForTests, STORAGE_SILENCE_MS, STORAGE_WAKE_GRACE_MS, trackStorage } from '@/utils/deviceStorage';
import { __resetServerAvailabilityForTests, reportServerAvailable, reportServerUnavailable } from '@/utils/serverAvailability';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';
import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';


type Language = 'en' | 'ru' | 'uk';
const mockDictionaries = { en, ru, uk };
let mockLanguage: Language = 'en';
const mockTranslate = (key: string): string => {
  let value: unknown = mockDictionaries[mockLanguage];
  for (const part of key.split('.')) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
  return typeof value === 'string' ? value : key;
};
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate, i18n: { language: mockLanguage, changeLanguage: jest.fn() } }) }));
jest.mock('@/utils/connectivityKnock', () => ({ startConnectivityKnock: () => () => undefined, knockNow: jest.fn() }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/data-engine/clientPolicy', () => ({ ...jest.requireActual('@/data-engine/clientPolicy'), isCollectionOnEngine: () => true }));

let client: QueryClient;
let logged: jest.SpyInstance;
let settings: ReturnType<typeof useDataDocument> | undefined;
beforeEach(() => {
  jest.useFakeTimers();
  mockLanguage = 'en'; settings = undefined;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  __resetServerAvailabilityForTests(); reportServerUnavailable(1);
});
afterEach(() => { cleanup(); client.clear(); logged.mockRestore(); __resetServerAvailabilityForTests(); jest.mocked(createBrowserDataEngine).mockReset(); jest.useRealTimers(); });

function SettingsProbe() {
  settings = useSettingsEngine()?.document;
  return <UserSettingsSyncStatus />;
}
const NoticeWrapper = ({ children }: { children: React.ReactNode }) => <ConnectionProvider><ServerUnavailableNoticeProvider><OfflineBanner />{children}</ServerUnavailableNoticeProvider></ConnectionProvider>;
const DataWrapper = ({ children }: { children: React.ReactNode }) => <NoticeWrapper><DataEngineProvider>{children}</DataEngineProvider></NoticeWrapper>;
async function showGlobalNotice() { await act(async () => { jest.advanceTimersByTime(STATUS_SETTLE_MS); await settleEngine(); }); }
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>
  <DataWrapper><UserSettingsProvider>{children}</UserSettingsProvider></DataWrapper>
</QueryClientProvider>;

const cases = (['en', 'ru', 'uk'] as const).flatMap(language => ['unavailable', 'deadline-exceeded'].map(code => ({ language, code })));
it.each(cases)('keeps the shared $code read outage out of the Settings error in $language', async ({ language, code }) => {
  mockLanguage = language;
  const refusal = Object.assign(new Error('Data engine request failed'), { code });
  const engine = { setOwner: jest.fn(), listWriteCaptures: jest.fn(async () => []), releaseWriteCapture: jest.fn(async () => undefined),
    subscribeSavedWork: jest.fn(() => () => undefined), openEditor: jest.fn().mockRejectedValue(refusal) };
  jest.mocked(createBrowserDataEngine).mockReturnValue({ engine, dispose: jest.fn(), editorId: () => 'profile-editor' } as unknown as BrowserDataEngine);
  render(<SettingsProbe />, { wrapper }); await showGlobalNotice();
  await waitFor(() => expect(settings?.loading).toBe(false));
  expect(engine.openEditor).toHaveBeenCalledWith({ collection: 'users', id: 'owner' }, 'profile-editor', expect.anything());
  expect(settings?.data).toBeNull();
  expect(settings?.status).toBeNull();
  expect(screen.queryByRole('region', { name: mockDictionaries[language].settings.title })).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('does not repeat a shared read outage as a failed recovery search', async () => {
  const list = jest.fn(async (): Promise<string[]> => { throw Object.assign(new Error('Data engine request failed'), { code: 'unavailable' }); });
  const identity = {};
  let loading: boolean | undefined;
  function DiscoveryProbe() {
    const discovery = useRecoveryDiscovery({ identity, enabled: true, version: 'first', list, recover: async () => undefined });
    loading = discovery.loading;
    return <DataSyncStatus subject={identity} status={null} recoveryError={discovery.error} />;
  }
  render(<DiscoveryProbe />, { wrapper: NoticeWrapper }); await showGlobalNotice();
  await waitFor(() => expect(loading).toBe(false));
  expect(list).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it.each([
  { code: undefined, key: 'dataSync.documentFailed' },
  { code: 'storage-silent', key: 'dataSync.readOnly.storage' },
])('retains an independent $code read failure even while the server notice is active', async ({ code, key }) => {
  const refusal = Object.assign(new Error('An independent reading failure'), { code });
  const engine = { setOwner: jest.fn(), listWriteCaptures: jest.fn(async () => []), releaseWriteCapture: jest.fn(async () => undefined),
    subscribeSavedWork: jest.fn(() => () => undefined), openEditor: jest.fn().mockRejectedValue(refusal) };
  jest.mocked(createBrowserDataEngine).mockReturnValue({ engine, dispose: jest.fn(), editorId: () => 'profile-editor' } as unknown as BrowserDataEngine);
  render(<SettingsProbe />, { wrapper }); await showGlobalNotice();
  expect(await screen.findByRole('alert')).toHaveTextContent(mockTranslate(key));
  expect(screen.getByRole('button', { name: mockTranslate('dataSync.retry') })).toBeEnabled();
  expect(settings?.loading).toBe(false);
});

const profileHarness = () => documentEngineHarness({ resource: { collection: 'users', id: 'owner' }, value: { language: 'en' }, metadata: { protocol: 1, generation: 'profile-generation', revision: 1, deleted: false } });

it('keeps the actual refusal of a settings action visible during the same outage', async () => {
  const harness = profileHarness();
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  render(<SettingsProbe />, { wrapper }); await showGlobalNotice();
  await waitFor(() => expect(settings?.status).not.toBeNull());
  const refusal = Object.assign(new Error('Data engine request failed'), { code: 'unavailable' });
  await act(async () => { await settings!.commit(() => { throw refusal; }).catch(() => undefined); await settleEngine(); });
  expect(await screen.findByRole('alert')).toHaveTextContent(en.dataSync.failure.serverUnavailable);
  expect(screen.getByRole('region', { name: en.settings.title })).toBeInTheDocument();
});

it('offers the failed read again when the shared notice ends and opens the real profile on retry', async () => {
  const harness = profileHarness();
  jest.mocked(createBrowserDataEngine).mockImplementation(options => {
    const browser = harness.createBrowser(options);
    const open = browser.engine.openEditor.bind(browser.engine);
    jest.spyOn(browser.engine, 'openEditor').mockRejectedValueOnce(Object.assign(new Error('Data engine request failed'), { code: 'unavailable' })).mockImplementation(open);
    return browser;
  });
  render(<SettingsProbe />, { wrapper }); await showGlobalNotice();
  await waitFor(() => expect(settings?.loading).toBe(false));
  act(() => reportServerAvailable(2));
  expect(await screen.findByRole('alert')).toHaveTextContent(en.dataSync.documentFailed);
  fireEvent.click(screen.getByRole('button', { name: en.dataSync.retry }));
  await waitFor(() => expect(settings?.data).toEqual({ language: 'en' }));
  expect(screen.queryByRole('region', { name: en.settings.title })).not.toBeInTheDocument();
  expect(settings?.loading).toBe(false);
});

it('does not confuse a completed unavailable list read with a still-waiting local store', async () => {
  jest.useFakeTimers();
  let release!: () => void;
  try {
    trackStorage('engine-cursors', new Promise<void>(resolve => { release = resolve; }));
    const peekCollectionCached = jest.fn(() => new Promise<never>(() => undefined));
    const peekCollectionRemote = jest.fn(() => new Promise<never>(() => undefined));
    const engine = { setOwner: jest.fn(), listWriteCaptures: jest.fn(async () => []), releaseWriteCapture: jest.fn(async () => undefined),
      subscribeSavedWork: jest.fn(() => () => undefined), peekCollectionCached, peekCollectionRemote,
      watchCollection: jest.fn(() => { throw Object.assign(new Error('Data engine request failed'), { code: 'unavailable' }); }) };
    jest.mocked(createBrowserDataEngine).mockReturnValue({ engine, dispose: jest.fn(), editorId: () => 'unused-editor' } as unknown as BrowserDataEngine);
    const view = renderHook(() => useDataCollection('studyNotes'), { wrapper: DataWrapper });
    await act(async () => { await settleEngine(); });
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.error).not.toBeNull();
    await act(async () => { jest.advanceTimersByTime(STORAGE_SILENCE_MS + STORAGE_WAKE_GRACE_MS + 1); await settleEngine(); });
    expect(peekCollectionCached).not.toHaveBeenCalled();
    expect(peekCollectionRemote).not.toHaveBeenCalled();
  } finally { cleanup(); release?.(); resetDeviceStorageForTests(); jest.useRealTimers(); }
});

it('retains the public failed-profile fact independently of the Settings notice', async () => {
  const engine = { setOwner: jest.fn(), listWriteCaptures: jest.fn(async () => []), releaseWriteCapture: jest.fn(async () => undefined),
    subscribeSavedWork: jest.fn(() => () => undefined), openEditor: jest.fn().mockRejectedValue(Object.assign(new Error('Data engine request failed'), { code: 'unavailable' })) };
  jest.mocked(createBrowserDataEngine).mockReturnValue({ engine, dispose: jest.fn(), editorId: () => 'profile-editor' } as unknown as BrowserDataEngine);
  render(<SettingsProbe />, { wrapper }); await showGlobalNotice();
  await waitFor(() => expect(settings?.loading).toBe(false));
  expect(settings?.error).toBe(en.dataSync.documentFailed);
});

it('keeps a document notification quiet without losing its failed-read fact', async () => {
  const engine = { setOwner: jest.fn(), listWriteCaptures: jest.fn(async () => []), releaseWriteCapture: jest.fn(async () => undefined),
    subscribeSavedWork: jest.fn(() => () => undefined), openEditor: jest.fn().mockRejectedValue(Object.assign(new Error('Data engine request failed'), { code: 'unavailable' })) };
  jest.mocked(createBrowserDataEngine).mockReturnValue({ engine, dispose: jest.fn(), editorId: () => 'document-editor' } as unknown as BrowserDataEngine);
  let document: ReturnType<typeof useDataDocument> | undefined;
  function DocumentNotice() {
    document = useDataDocument({ collection: 'sermons', id: 'sermon' });
    return <DataSyncStatus subject={document.recoveryIdentity} status={document.status} error={document.error} errorWords={document.errorWords} onRetry={document.retry} />;
  }
  render(<DocumentNotice />, { wrapper: DataWrapper }); await showGlobalNotice();
  await waitFor(() => expect(document?.loading).toBe(false));
  expect(document?.error).toBe(en.dataSync.documentFailed);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: en.dataSync.retry })).not.toBeInTheDocument();
});

it('keeps a manual form opening notice quiet while preserving its read failure', async () => {
  const engine = { setOwner: jest.fn(), listWriteCaptures: jest.fn(async () => []), releaseWriteCapture: jest.fn(async () => undefined),
    subscribeSavedWork: jest.fn(() => () => undefined), openEditor: jest.fn().mockRejectedValue(Object.assign(new Error('Data engine request failed'), { code: 'unavailable' })) };
  jest.mocked(createBrowserDataEngine).mockReturnValue({ engine, dispose: jest.fn(), editorId: () => 'form-editor' } as unknown as BrowserDataEngine);
  let form: ReturnType<typeof useDataForm> | undefined;
  function FormNotice() {
    form = useDataForm({ collection: 'users', id: 'owner' }, 'qa-profile', [['language']]);
    return <DataSyncStatus subject={form.recoveryIdentity} status={form.status} error={form.error} errorWords={form.errorWords} onRetry={form.retry} />;
  }
  render(<FormNotice />, { wrapper: DataWrapper }); await showGlobalNotice();
  await waitFor(() => expect(form?.loading).toBe(false));
  expect(form?.error).toBe(en.dataSync.documentFailed);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('keeps a manual form save refusal visible while a shared read outage is announced', async () => {
  const harness = profileHarness();
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  let form: ReturnType<typeof useDataForm> | undefined;
  function FormNotice() {
    form = useDataForm({ collection: 'users', id: 'owner' }, 'qa-profile', [['language']]);
    return <DataSyncStatus subject={form.recoveryIdentity} status={form.status} error={form.error} errorWords={form.errorWords} onRetry={form.retry} />;
  }
  render(<FormNotice />, { wrapper: DataWrapper }); await showGlobalNotice();
  await waitFor(() => expect(form?.loading).toBe(false));
  await act(async () => { await form!.begin(); });
  const refusal = Object.assign(new Error('Data engine request failed'), { code: 'unavailable' });
  await act(async () => { await form!.save(() => { throw refusal; }).catch(() => undefined); await settleEngine(); });
  expect(await screen.findByRole('alert')).toHaveTextContent(en.dataSync.failure.serverUnavailable);
  expect(screen.getByRole('button', { name: en.dataSync.retry })).toBeEnabled();
});

it('keeps an explanation until the shared banner appears and shares it with a late-mounted notice', () => {
  const words = failureWords(Object.assign(new Error('Data engine request failed'), { code: 'unavailable' }), 'dataSync.documentFailed');
  const notice = (key: string) => <NoticeWrapper><DataSyncStatus key={key} subject={key} status={null} error={en.dataSync.documentFailed} errorWords={words} onRetry={async () => undefined} /></NoticeWrapper>;
  const { rerender } = render(notice('first'));
  expect(screen.queryByText(en.connection.serverUnavailableBanner, { exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(en.dataSync.documentFailed);
  act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS - 1); });
  expect(screen.getByRole('alert')).toHaveTextContent(en.dataSync.documentFailed);
  act(() => { jest.advanceTimersByTime(1); });
  expect(screen.getByText(en.connection.serverUnavailableBanner, { exact: true })).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  rerender(notice('late'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  act(() => reportServerAvailable(2));
  expect(screen.queryByText(en.connection.serverUnavailableBanner, { exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(en.dataSync.documentFailed);
  expect(screen.getByRole('button', { name: en.dataSync.retry })).toBeEnabled();
});

it.each(['record', 'collection'] as const)('keeps a settled %s explanation until the shared notice is visible', kind => {
  act(() => reportServerAvailable(2));
  const status: SyncStatus = { phase: 'saved', freshness: 'cache', checking: false, readFailed: true, hasForeignChange: false,
    canSave: false, canRemove: false, canAcceptRemote: false, canKeepLocal: false };
  const state: CollectionState = { snapshots: [], complete: false, freshness: 'cache', checking: false, version: 1, error: null };
  render(<NoticeWrapper>{kind === 'record' ? <DataSyncStatus subject="record" status={status} /> : <DataCollectionStatus state={state} />}</NoticeWrapper>);
  const text = kind === 'record' ? en.dataSync.readFailed : en.dataSync.collectionIncomplete;
  act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS); });
  expect(screen.getByText(text, { exact: true })).toBeInTheDocument();
  act(() => reportServerUnavailable(3));
  expect(screen.queryByText(en.connection.serverUnavailableBanner, { exact: true })).not.toBeInTheDocument();
  expect(screen.getByText(text, { exact: true })).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS); });
  expect(screen.getByText(en.connection.serverUnavailableBanner, { exact: true })).toBeInTheDocument();
  expect(screen.queryByText(text, { exact: true })).not.toBeInTheDocument();
});
