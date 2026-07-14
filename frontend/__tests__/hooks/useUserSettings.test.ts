import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useUserSettings } from '@/hooks/useUserSettings';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import {
  updatePrepModeAccess,
  updateAudioGenerationAccess,
  updateStructurePreviewAccess,
  updateFirstDayOfWeek,
  updateFunctionModelPreference,
  updateModelPreference,
} from '@/services/userSettings.service';

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(),
}));

jest.mock('@/hooks/useServerFirstQuery', () => ({
  useServerFirstQuery: jest.fn(),
}));

jest.mock('@/services/userSettings.service', () => ({
  getUserSettings: jest.fn().mockResolvedValue(null),
  updatePrepModeAccess: jest.fn().mockResolvedValue(undefined),
  updateAudioGenerationAccess: jest.fn().mockResolvedValue(undefined),
  updateStructurePreviewAccess: jest.fn().mockResolvedValue(undefined),
  updateFirstDayOfWeek: jest.fn().mockResolvedValue(undefined),
  updateFunctionModelPreference: jest.fn().mockResolvedValue(undefined),
  updateModelPreference: jest.fn().mockResolvedValue(undefined),
}));

const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;
const mockUseServerFirstQuery = useServerFirstQuery as jest.MockedFunction<typeof useServerFirstQuery>;
const mockUpdatePrepModeAccess = updatePrepModeAccess as jest.MockedFunction<typeof updatePrepModeAccess>;
const mockUpdateAudioGenerationAccess = updateAudioGenerationAccess as jest.MockedFunction<typeof updateAudioGenerationAccess>;
const mockUpdateStructurePreviewAccess = updateStructurePreviewAccess as jest.MockedFunction<typeof updateStructurePreviewAccess>;
const mockUpdateFirstDayOfWeek = updateFirstDayOfWeek as jest.MockedFunction<typeof updateFirstDayOfWeek>;
const mockUpdateFunctionModelPreference = updateFunctionModelPreference as jest.MockedFunction<typeof updateFunctionModelPreference>;
const mockUpdateModelPreference = updateModelPreference as jest.MockedFunction<typeof updateModelPreference>;

const fakeSettings = {
  enablePrepMode: false,
  enableAudioGeneration: false,
  enableStructurePreview: false,
} as any;

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useUserSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseOnlineStatus.mockReturnValue(true);
    mockUseServerFirstQuery.mockReturnValue({
      data: fakeSettings,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as any);
  });

  it('returns settings and helpers from query', () => {
    const { result } = renderHook(() => useUserSettings('user1'), { wrapper: makeWrapper() });

    expect(result.current.settings).toBe(fakeSettings);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.updatePrepModeAccess).toBe('function');
    expect(typeof result.current.updateAudioGenerationAccess).toBe('function');
    expect(typeof result.current.updateStructurePreviewAccess).toBe('function');
    expect(typeof result.current.updateFirstDayOfWeek).toBe('function');
    expect(typeof result.current.updateModelPreference).toBe('function');
  });

  it('updateStructurePreviewAccess calls service with userId and value', async () => {
    const { result } = renderHook(() => useUserSettings('user1'), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.updateStructurePreviewAccess(true);
    });

    expect(mockUpdateStructurePreviewAccess).toHaveBeenCalledWith('user1', true);
  });

  it('updateStructurePreviewAccess with false also calls service', async () => {
    const { result } = renderHook(() => useUserSettings('user1'), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.updateStructurePreviewAccess(false);
    });

    expect(mockUpdateStructurePreviewAccess).toHaveBeenCalledWith('user1', false);
  });

  it('updatePrepModeAccess calls service', async () => {
    const { result } = renderHook(() => useUserSettings('user1'), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.updatePrepModeAccess(true);
    });

    expect(mockUpdatePrepModeAccess).toHaveBeenCalledWith('user1', true);
  });

  it('updateAudioGenerationAccess calls service', async () => {
    const { result } = renderHook(() => useUserSettings('user1'), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.updateAudioGenerationAccess(true);
    });

    expect(mockUpdateAudioGenerationAccess).toHaveBeenCalledWith('user1', true);
  });

  it('updateFirstDayOfWeek calls service', async () => {
    const { result } = renderHook(() => useUserSettings('user1'), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.updateFirstDayOfWeek('monday');
    });

    expect(mockUpdateFirstDayOfWeek).toHaveBeenCalledWith('user1', 'monday');
  });

  it('updateModelPreference calls service with userId and selected target', async () => {
    const { result } = renderHook(() => useUserSettings('user1'), { wrapper: makeWrapper() });
    const preference = { preferredProviderId: 'gemini' as const, preferredModelId: 'gemini-2.5-flash-lite' };

    await act(async () => {
      await result.current.updateModelPreference(preference);
    });

    expect(mockUpdateModelPreference).toHaveBeenCalledWith('user1', preference);
  });

  it('refreshes entitlement after saving a per-function model preference', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useUserSettings('user1'), { wrapper });
    const preference = {
      preferredTts: { providerId: 'openai' as const, modelId: 'gpt-4o-mini-tts' },
    };

    await act(async () => {
      await result.current.updateFunctionModelPreference(preference);
    });

    expect(mockUpdateFunctionModelPreference).toHaveBeenCalledWith('user1', preference);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['me', 'entitlement'] });
  });

  it('does not throw on a toggle when offline — buffers it (Stage 2)', async () => {
    // Offline no longer short-circuits: the toggle flips optimistically and the
    // mutation pauses + persists, replaying on reconnect. So the call resolves.
    mockUseOnlineStatus.mockReturnValue(false);
    const { result } = renderHook(() => useUserSettings('user1'), { wrapper: makeWrapper() });

    await act(async () => {
      await expect(result.current.updateStructurePreviewAccess(true)).resolves.toBeUndefined();
    });
  });

  it('throws when userId is not provided', async () => {
    const { result } = renderHook(() => useUserSettings(undefined), { wrapper: makeWrapper() });

    await expect(
      act(async () => {
        await result.current.updateStructurePreviewAccess(true);
      })
    ).rejects.toThrow('No user');
  });

  it('throws when userId is not provided for prepMode', async () => {
    const { result } = renderHook(() => useUserSettings(undefined), { wrapper: makeWrapper() });

    await expect(
      act(async () => {
        await result.current.updatePrepModeAccess(true);
      })
    ).rejects.toThrow('No user');
  });

  it('throws when userId is not provided for audioGeneration', async () => {
    const { result } = renderHook(() => useUserSettings(undefined), { wrapper: makeWrapper() });

    await expect(
      act(async () => {
        await result.current.updateAudioGenerationAccess(true);
      })
    ).rejects.toThrow('No user');
  });

  it('throws when userId is not provided for first day of week', async () => {
    const { result } = renderHook(() => useUserSettings(undefined), { wrapper: makeWrapper() });

    await expect(
      act(async () => {
        await result.current.updateFirstDayOfWeek('monday');
      })
    ).rejects.toThrow('No user');
  });
});
