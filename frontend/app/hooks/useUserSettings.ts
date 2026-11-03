import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useSettingsEngine } from '@/hooks/userSettingsEngineContext';

import type { UserSettings } from '@/models/models';
import type { FunctionModelPreference, ModelPreference } from '@/services/userSettings.service';
import type { FirstDayOfWeek } from '@/utils/weekStart';

/** Feature readers share the same engine draft as the settings controls. */
export function useUserSettingsQuery(userId: string | null | undefined) {
  const isOnline = useOnlineStatus();
  const source = useSettingsEngine();
  const document = source && source.owner === userId ? source.document : null;
  return {
    isOnline,
    data: document?.data ? { ...document.data, id: userId, userId } as UserSettings : null,
    isLoading: Boolean(userId) && (!document || document.loading),
    error: document?.error ? new Error(document.error) : null,
    refetch: async () => { await document?.retry(); },
  };
}

/** All private settings changes use the owner-scoped shared editor and its durable journal. */
export function useUserSettings(userId: string | null | undefined) {
  const source = useSettingsEngine();
  const document = source && source.owner === userId ? source.document : null;
  const readOnly = !document?.state || document.readOnly;
  const busy = readOnly || Boolean(document?.state?.preparing) || document?.state?.durable === false;
  const patch = async (value: Partial<UserSettings>): Promise<void> => {
    if (!document) throw new Error('The settings editor is not ready');
    await document.commit(current => {
      return { ...current, ...value };
    });
  };
  return {
    settings: document?.data ? { ...document.data, id: userId, userId } as UserSettings : null,
    loading: Boolean(userId) && (!document || document.loading),
    error: document?.error ? new Error(document.error) : null,
    readOnly,
    refresh: async () => { await document?.retry(); },
    updateAudioGenerationAccess: (value: boolean) => patch({ enableAudioGeneration: value }), updatingAudioGeneration: busy,
    updateFirstDayOfWeek: (value: FirstDayOfWeek) => patch({ firstDayOfWeek: value }), updatingFirstDayOfWeek: busy,
    updateShowAppVersion: (value: boolean) => patch({ showAppVersion: value }), updatingShowAppVersion: busy,
    updateModelPreference: (value: ModelPreference) => patch(value), updatingModelPreference: busy,
    updateFunctionModelPreference: (value: FunctionModelPreference) => patch(value), updatingFunctionModelPreference: busy,
  };
}
