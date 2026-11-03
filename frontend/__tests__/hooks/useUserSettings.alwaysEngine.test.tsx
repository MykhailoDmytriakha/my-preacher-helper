import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider, useDataDocument } from '@/data-engine/react.client';
import { useUserSettings } from '@/hooks/useUserSettings';
import { UserSettingsEngineContext } from '@/hooks/userSettingsEngineContext';
import { useAuth } from '@/providers/AuthProvider';
import * as service from '@/services/userSettings.service';
import { awaitSettingsWrite } from '@/utils/settingsWrite';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/services/userSettings.service', () => ({
  getUserSettings: jest.fn(), setLanguageCookie: jest.fn(),
  updateAudioGenerationAccess: jest.fn(), updateShowAppVersion: jest.fn(),
  updateFirstDayOfWeek: jest.fn(), updateModelPreference: jest.fn(),
  updateFunctionModelPreference: jest.fn(),
}));

const owner = 'owner';
const resource = { collection: 'users', id: owner };
const initial = {
  userId: owner, language: 'en', firstDayOfWeek: 'sunday',
  enableAudioGeneration: false, showAppVersion: false,
};
const clients: QueryClient[] = [];

function OwnerSettingsContext({ children }: { children: React.ReactNode }) {
  const document = useDataDocument(resource, { readOnlyCopy: true });
  return <UserSettingsEngineContext.Provider value={{ owner, document }}>{children}</UserSettingsEngineContext.Provider>;
}

function setup() {
  const harness = documentEngineHarness({
    resource,
    value: initial,
    metadata: { protocol: 1, generation: 'settings', revision: 1, deleted: false },
  });
  jest.mocked(createBrowserDataEngine).mockImplementation(() => harness.createBrowser());
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>
    <DataEngineProvider><OwnerSettingsContext>{children}</OwnerSettingsContext></DataEngineProvider>
  </QueryClientProvider>;
  return { harness, wrapper };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
  delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
  jest.mocked(useAuth).mockReturnValue({ user: { uid: owner }, loading: false, isAuthenticated: true } as ReturnType<typeof useAuth>);
  jest.mocked(service.getUserSettings).mockImplementation(() => new Promise(() => undefined));
  for (const write of [
    service.updateAudioGenerationAccess,
    service.updateFirstDayOfWeek,
    service.updateShowAppVersion,
    service.updateModelPreference,
    service.updateFunctionModelPreference,
  ]) jest.mocked(write).mockResolvedValue(undefined);
});

afterEach(() => {
  clients.splice(0).forEach(client => client.clear());
  delete process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
  delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
});

test.each([
  ['switches unset', undefined],
  ['global switch false', 'false'],
])('routes every private settings action through the existing owner editor when %s', async (_label, enabled) => {
  if (enabled !== undefined) process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED = enabled;
  const context = setup();
  const hook = renderHook(() => ({ settings: useUserSettings(owner) }), { wrapper: context.wrapper });
  await waitFor(() => expect(hook.result.current.settings.readOnly).toBe(false));

  await act(async () => {
    await awaitSettingsWrite(hook.result.current.settings.updateAudioGenerationAccess(true), jest.fn());
    await awaitSettingsWrite(hook.result.current.settings.updateFirstDayOfWeek('monday'), jest.fn());
    await awaitSettingsWrite(hook.result.current.settings.updateShowAppVersion(true), jest.fn());
    await awaitSettingsWrite(hook.result.current.settings.updateModelPreference({
      preferredProviderId: 'openai', preferredModelId: 'gpt-4o-mini',
    }), jest.fn());
    await awaitSettingsWrite(hook.result.current.settings.updateFunctionModelPreference({
      preferredTts: { providerId: 'openai', modelId: 'gpt-4o-mini-tts' },
    }), jest.fn());
    await settleEngine();
  });

  expect({
    audioGeneration: jest.mocked(service.updateAudioGenerationAccess).mock.calls.length,
    firstDayOfWeek: jest.mocked(service.updateFirstDayOfWeek).mock.calls.length,
    showAppVersion: jest.mocked(service.updateShowAppVersion).mock.calls.length,
    modelPreference: jest.mocked(service.updateModelPreference).mock.calls.length,
    functionModelPreference: jest.mocked(service.updateFunctionModelPreference).mock.calls.length,
  }).toEqual({
    audioGeneration: 0,
    firstDayOfWeek: 0,
    showAppVersion: 0,
    modelPreference: 0,
    functionModelPreference: 0,
  });

  await waitFor(() => expect(context.harness.server.value).toMatchObject({
    enableAudioGeneration: true,
    firstDayOfWeek: 'monday',
    showAppVersion: true,
    preferredProviderId: 'openai',
    preferredModelId: 'gpt-4o-mini',
    preferredTts: { providerId: 'openai', modelId: 'gpt-4o-mini-tts' },
  }));
  expect(context.harness.transport.send).toHaveBeenCalledTimes(5);
  expect(service.updateAudioGenerationAccess).not.toHaveBeenCalled();
  expect(service.updateFirstDayOfWeek).not.toHaveBeenCalled();
  expect(service.updateShowAppVersion).not.toHaveBeenCalled();
  expect(service.updateModelPreference).not.toHaveBeenCalled();
  expect(service.updateFunctionModelPreference).not.toHaveBeenCalled();
  hook.unmount();
});
