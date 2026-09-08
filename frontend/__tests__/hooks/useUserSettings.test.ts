import { act, renderHook, waitFor } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import React from 'react';

import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { useUserSettings } from '@/hooks/useUserSettings';
import * as service from '@/services/userSettings.service';
import { SETTINGS_MUTATION_KEYS } from '@/utils/mutationDefaults';

import type { UserSettings } from '@/models/models';
import type { WriteSubmission } from '@/utils/recoverableWrite';

jest.mock('@/hooks/useServerFirstQuery', () => ({ useServerFirstQuery: jest.fn() }));
jest.mock('@/services/userSettings.service', () => ({
  getUserSettings: jest.fn(),
  updatePrepModeAccess: jest.fn(),
  updateAudioGenerationAccess: jest.fn(),
  updateStructurePreviewAccess: jest.fn(),
  updateShowAppVersion: jest.fn(),
  updateFirstDayOfWeek: jest.fn(),
  updateModelPreference: jest.fn(),
  updateFunctionModelPreference: jest.fn(),
}));

const original: UserSettings = {
  id: 'user1', userId: 'user1', language: 'ru',
  enablePrepMode: false, enableAudioGeneration: false, enableStructurePreview: false,
  showAppVersion: false, firstDayOfWeek: 'sunday',
};
const queryKey = ['user-settings', 'user1'];
type Settings = ReturnType<typeof useUserSettings>;
const model = { preferredProviderId: 'gemini' as const, preferredModelId: 'gemini-2.5-flash-lite' };
const functionModel = { preferredTts: { providerId: 'openai' as const, modelId: 'gpt-4o-mini-tts' } };
const operations: {
  name: keyof typeof SETTINGS_MUTATION_KEYS;
  write: jest.Mock;
  value: unknown;
  patch: Partial<UserSettings>;
  submit: (settings: Settings) => WriteSubmission;
}[] = [
  { name: 'prepMode', write: jest.mocked(service.updatePrepModeAccess), value: true,
    patch: { enablePrepMode: true }, submit: s => s.updatePrepModeAccess(true) },
  { name: 'audioGeneration', write: jest.mocked(service.updateAudioGenerationAccess), value: true,
    patch: { enableAudioGeneration: true }, submit: s => s.updateAudioGenerationAccess(true) },
  { name: 'structurePreview', write: jest.mocked(service.updateStructurePreviewAccess), value: false,
    patch: { enableStructurePreview: false }, submit: s => s.updateStructurePreviewAccess(false) },
  { name: 'firstDayOfWeek', write: jest.mocked(service.updateFirstDayOfWeek), value: 'monday',
    patch: { firstDayOfWeek: 'monday' }, submit: s => s.updateFirstDayOfWeek('monday') },
  { name: 'showAppVersion', write: jest.mocked(service.updateShowAppVersion), value: true,
    patch: { showAppVersion: true }, submit: s => s.updateShowAppVersion(true) },
  { name: 'modelPreference', write: jest.mocked(service.updateModelPreference), value: model,
    patch: model, submit: s => s.updateModelPreference(model) },
  { name: 'functionModelPreference', write: jest.mocked(service.updateFunctionModelPreference), value: functionModel,
    patch: functionModel, submit: s => s.updateFunctionModelPreference(functionModel) },
];

let queryClient: QueryClient;
const refetch = jest.fn();
function mount(uid: string | undefined) {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return renderHook(() => useUserSettings(uid), { wrapper });
}

beforeEach(() => {
  jest.clearAllMocks();
  onlineManager.setOnline(true);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClient.setQueryData(queryKey, original);
  operations.forEach(({ write }) => write.mockReset().mockResolvedValue(undefined));
  jest.mocked(useServerFirstQuery).mockReturnValue({
    ...new QueryObserver<UserSettings>(queryClient, { queryKey }).getCurrentResult(),
    isOnline: true,
    refetch,
  });
});

afterEach(() => {
  onlineManager.setOnline(true);
  queryClient.clear();
});

describe('useUserSettings public behavior', () => {
  it('exposes the shared settings query and its refresh action', () => {
    const { result } = mount('user1');
    expect(result.current.settings).toBe(original);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    result.current.refresh();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(useServerFirstQuery).toHaveBeenCalledWith(expect.objectContaining({ queryKey, enabled: true }));
  });

  it.each(operations)('$name patches the cache, persists the original payload and keeps its queue key', async operation => {
    let finish!: () => void;
    operation.write.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = mount('user1');
    let submission!: WriteSubmission;
    await act(async () => {
      submission = operation.submit(result.current);
      await expect(submission.acceptance).resolves.toEqual(expect.objectContaining({ kind: 'queued' }));
    });
    await waitFor(() => expect(operation.write).toHaveBeenCalledWith('user1', operation.value));
    expect(queryClient.getQueryData(queryKey)).toEqual({ ...original, ...operation.patch });
    expect(queryClient.getMutationCache().getAll()[0].options.mutationKey).toEqual(SETTINGS_MUTATION_KEYS[operation.name]);
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => { finish(); await submission.persistence; });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['user-settings'] });
    if (operation.name === 'functionModelPreference') {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me', 'entitlement'] });
    } else {
      expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['me', 'entitlement'] });
    }
  });

  it.each(operations)('$name restores the previous cache when persistence is refused', async operation => {
    let refuse!: (error: Error) => void;
    operation.write.mockReturnValueOnce(new Promise<void>((_resolve, reject) => { refuse = reject; }));
    const { result } = mount('user1');
    await act(async () => {
      const submission = operation.submit(result.current);
      await expect(submission.acceptance).resolves.toEqual(expect.objectContaining({ kind: 'queued' }));
      refuse(new Error('write refused'));
      await expect(submission.persistence).rejects.toThrow('write refused');
    });
    expect(queryClient.getQueryData(queryKey)).toEqual(original);
  });

  it.each(operations)('$name refuses unauthenticated writes without starting a mutation', async operation => {
    const { result } = mount(undefined);
    await act(async () => {
      const submission = operation.submit(result.current);
      await expect(submission.acceptance).rejects.toThrow('No signed-in user');
      await expect(submission.persistence).rejects.toThrow('No signed-in user');
    });
    expect(operation.write).not.toHaveBeenCalled();
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it('keeps an offline change queued until React Query resumes it online', async () => {
    onlineManager.setOnline(false);
    const { result } = mount('user1');
    let submission!: WriteSubmission;
    await act(async () => {
      submission = result.current.updateStructurePreviewAccess(true);
      await expect(submission.acceptance).resolves.toEqual(expect.objectContaining({ kind: 'queued' }));
    });
    await waitFor(() => expect(queryClient.getQueryData(queryKey)).toEqual({ ...original, enableStructurePreview: true }));
    expect(service.updateStructurePreviewAccess).not.toHaveBeenCalled();
    expect(queryClient.getMutationCache().getAll()[0].state.isPaused).toBe(true);
    await act(async () => { onlineManager.setOnline(true); await submission.persistence; });
    expect(service.updateStructurePreviewAccess).toHaveBeenCalledTimes(1);
    expect(service.updateStructurePreviewAccess).toHaveBeenCalledWith('user1', true);
  });

  it('creates a minimal cache entry when settings have not loaded', async () => {
    queryClient.removeQueries({ queryKey });
    const { result } = mount('user1');
    await act(async () => { await result.current.updatePrepModeAccess(true).persistence; });
    expect(queryClient.getQueryData(queryKey)).toEqual({ id: 'user1', userId: 'user1', language: 'en', enablePrepMode: true });
  });

  it('restores an absent cache to null after a failed write', async () => {
    queryClient.removeQueries({ queryKey });
    jest.mocked(service.updatePrepModeAccess).mockRejectedValueOnce(new Error('write refused'));
    const { result } = mount('user1');
    await act(async () => { await expect(result.current.updatePrepModeAccess(true).persistence).rejects.toThrow('write refused'); });
    expect(queryClient.getQueryData(queryKey)).toBeNull();
  });

  it('refuses acceptance too when the write fails before the queue accepts it', async () => {
    jest.mocked(service.updatePrepModeAccess).mockRejectedValueOnce(new Error('early refusal'));
    const { result } = mount('user1');
    await act(async () => {
      const submission = result.current.updatePrepModeAccess(true);
      await expect(submission.acceptance).rejects.toThrow('early refusal');
      await expect(submission.persistence).rejects.toThrow('early refusal');
    });
    expect(queryClient.getQueryData(queryKey)).toEqual(original);
  });
});
