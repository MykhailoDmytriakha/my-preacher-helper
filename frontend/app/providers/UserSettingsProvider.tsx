'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { isCollectionOnEngine } from '@/data-engine/clientPolicy';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataDocument, useRecoveryDiscovery } from '@/data-engine/react.client';
import { UserSettingsEngineContext, useSettingsEngine } from '@/hooks/userSettingsEngineContext';
import { useAuth } from '@/providers/AuthProvider';
import { setLanguageCookie } from '@/services/userSettings.service';

/** One settings editor per signed-in workspace, shared by navigation and every feature. */
export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return isCollectionOnEngine('users') && user
    ? <EngineSettingsProvider key={user.uid} owner={user.uid}>{children}</EngineSettingsProvider>
    : <>{children}</>;
}

function EngineSettingsProvider({ owner, children }: { owner: string; children: ReactNode }) {
  const document = useDataDocument({ collection: 'users', id: owner }, { readOnlyCopy: true });
  const { i18n } = useTranslation();
  const queries = useQueryClient();
  const language = document.data?.language;
  const confirmedPreference = JSON.stringify([
    document.confirmed?.value?.preferredProviderId, document.confirmed?.value?.preferredModelId,
    document.confirmed?.value?.preferredTranscription, document.confirmed?.value?.preferredText,
    document.confirmed?.value?.preferredTts,
  ]);
  const previousPreference = useRef(confirmedPreference);
  useEffect(() => {
    if (typeof language !== 'string' || !['en', 'ru', 'uk'].includes(language)) return;
    setLanguageCookie(language);
    if (i18n.language !== language) void i18n.changeLanguage(language);
  }, [language, i18n]);
  useEffect(() => {
    if (previousPreference.current === confirmedPreference) return;
    previousPreference.current = confirmedPreference;
    void queries.invalidateQueries({ queryKey: ['me', 'entitlement'] });
  }, [confirmedPreference, queries]);
  return <UserSettingsEngineContext.Provider value={{ owner, document }}>{children}</UserSettingsEngineContext.Provider>;
}

/** Delivery, unavailable storage and recovered work remain visible after leaving Settings. */
export function UserSettingsSyncStatus() {
  const source = useSettingsEngine();
  return source ? <EngineSettingsStatus /> : null;
}

function EngineSettingsStatus() {
  const { document } = useSettingsEngine()!;
  const { t } = useTranslation();
  const title = t('settings.title');
  const recovery = useRecoveryDiscovery({
    identity: document.recoveryIdentity, enabled: !document.loading && document.status !== null,
    version: JSON.stringify([document.status?.phase, document.confirmed?.metadata?.revision]),
    list: async () => (await document.listRecoverable()).map(({ id, record }) => ({
      id, title, preview: JSON.stringify(record.checkpoint.draft, null, 2),
    })),
    recover: document.recover,
  });
  // Whether there is anything to say is the status's own rule (isSyncTrouble); it names the settings only then.
  return <DataSyncStatus title={title} className="my-3" status={document.status} error={document.readOnlyReason ?? document.error}
    onRetry={document.retry} onKeepLocal={document.keepLocal} onAcceptRemote={document.acceptRemote}
    recoveryChoices={recovery.choices} recoveryLoading={recovery.loading} recoveryError={recovery.error}
    onRecover={recovery.recover} />;
}
