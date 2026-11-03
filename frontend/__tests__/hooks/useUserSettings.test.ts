import { act, renderHook } from '@testing-library/react';
import React from 'react';

import { useUserSettings } from '@/hooks/useUserSettings';
import { UserSettingsEngineContext } from '@/hooks/userSettingsEngineContext';
import { useDataDocument } from '@/data-engine/react.client';

import type { UserSettings } from '@/models/models';

type SettingsDocument = ReturnType<typeof useDataDocument>;
type SettingsSource = NonNullable<React.ContextType<typeof UserSettingsEngineContext>>;

const owner = 'owner';
const initial: UserSettings = {
  id: owner, userId: owner, language: 'ru', enableAudioGeneration: false,
  showAppVersion: false, firstDayOfWeek: 'sunday',
};
const model = { preferredProviderId: 'gemini' as const, preferredModelId: 'gemini-2.5-flash-lite' };
const functionModel = { preferredTts: { providerId: 'openai' as const, modelId: 'gpt-4o-mini-tts' } };
const operations = (settings: ReturnType<typeof useUserSettings>) => [
  settings.updateAudioGenerationAccess(true),
  settings.updateFirstDayOfWeek('monday'),
  settings.updateShowAppVersion(true),
  settings.updateModelPreference(model),
  settings.updateFunctionModelPreference(functionModel),
];

function sourceFor(sourceOwner = owner, data: UserSettings | null = initial) {
  const document = {
    data,
    loading: false,
    error: null,
    readOnly: false,
    state: { durable: true, preparing: false },
    commit: jest.fn(async () => undefined),
    retry: jest.fn(async () => undefined),
  } as unknown as SettingsDocument;
  return { source: { owner: sourceOwner, document } as SettingsSource, document };
}

const wrapper = (source?: SettingsSource) => ({ children }: { children: React.ReactNode }) =>
  React.createElement(UserSettingsEngineContext.Provider, { value: source ?? null }, children);

describe('useUserSettings shared editor boundary', () => {
  it.each([
    ['missing context', undefined, 'another-owner'],
    ['different owner context', owner, 'another-owner'],
  ])('is read-only and refuses all private changes with %s', async (_name, contextOwner, userId) => {
    const held = contextOwner ? sourceFor(contextOwner) : null;
    const { result } = renderHook(() => useUserSettings(userId), { wrapper: wrapper(held?.source) });

    expect(result.current.readOnly).toBe(true);
    expect(result.current.settings).toBeNull();
    await act(async () => {
      for (const operation of operations(result.current)) {
        await expect(operation).rejects.toThrow('The settings editor is not ready');
      }
    });
    if (held) expect(held.document.commit).not.toHaveBeenCalled();
  });

  it('projects the matching owner document and refreshes through its editor', async () => {
    const held = sourceFor();
    const { result } = renderHook(() => useUserSettings(owner), { wrapper: wrapper(held.source) });

    expect(result.current.readOnly).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.settings).toEqual(initial);
    await act(async () => { await result.current.refresh(); });
    expect(held.document.retry).toHaveBeenCalledTimes(1);
  });
});
