'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

import { isCollectionOnEngine } from '@/data-engine/clientPolicy';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataDocument, useRecoveryDiscovery } from '@/data-engine/react.client';
import { UserSettingsEngineContext, useSettingsEngine } from '@/hooks/userSettingsEngineContext';
import { useAuth } from '@/providers/AuthProvider';
import { setLanguageCookie } from '@/services/userSettings.service';
import { connectAccount, setAccountReading, setAccountWriter, type AccountPart } from '@/utils/accountChoice';
import { EDITOR_STORAGE, isStorageSilent, subscribeDeviceStorage } from '@/utils/deviceStorage';
import { useTranslation } from '@locales/useTranslation';

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
  return (
    <UserSettingsEngineContext.Provider value={{ owner, document }}>
      <ReadingSettingsSync />
      {children}
    </UserSettingsEngineContext.Provider>
  );
}

/**
 * THE READER'S SETTINGS IN THE ACCOUNT (the owner, 2026-11-02): what this settings editor holds is what the stores the
 * screens read show (`utils/accountChoice.ts`), and a change made on the device goes up through it — the fields the person
 * changed, laid on the editor's copy of the part. Nothing of the Bible is imported here: each store joins when its screen
 * loads it.
 */
export function ReadingSettingsSync() {
  const { owner, document } = useSettingsEngine()!;
  // Device storage known silent: a change now would wait behind it, so none is taken (the editor's own state may not say so yet).
  const silent = useSyncExternalStore(subscribeDeviceStorage, () => isStorageSilent(EDITOR_STORAGE), () => false);
  // Writable as the other settings are (`useUserSettings` busy): an editor, not a copy for reading, its storage keeping.
  const writable = Boolean(document.state) && !document.readOnly && document.state?.durable !== false && !silent;
  // The editor's commit is a new function on every draw: the writer reaches the latest through a ref, and is handed to the
  // stores again only when writing becomes possible or impossible.
  const commit = useRef(document.commit);
  useEffect(() => { commit.current = document.commit; });
  useEffect(() => {
    if (!writable) { setAccountWriter(null); return undefined; }
    setAccountWriter(async (part: AccountPart, change: object, shown: object) => {
      await commit.current((current) => {
        const reading = isRecord(current?.reading) ? current.reading : {};
        // The account's newest copy of the part wins over what the device showed; only the changed fields replace it.
        const held = isRecord(reading[part]) ? reading[part] : null;
        return { ...(current ?? {}), reading: { ...reading, [part]: { ...(held ?? shown), ...change } } } as typeof current;
      });
    });
    return () => setAccountWriter(null);
  }, [writable]);
  // This account's from now — connected while the page is laid out, before any screen beside it can save; signed out, or
  // another account coming, the stores forget it.
  useLayoutEffect(() => connectAccount(owner), [owner]);
  const reading = document.data?.reading;
  const heard = document.data !== null && document.data !== undefined;
  // The server has answered in this visit. A confirmed copy kept on the device may not have heard of another device's
  // choice yet, so it never decides that the account has none (`data-engine/observer.ts`, readiness).
  const answered = document.status?.freshness === 'server';
  const held = JSON.stringify(reading ?? null);
  // The server's newer copy the editor has not taken yet (it waits while this device's work is on its way).
  const waiting = JSON.stringify(document.remote?.value?.reading ?? null);
  useEffect(() => {
    if (!heard) return;
    type Reading = Partial<Record<AccountPart, unknown>> | null;
    setAccountReading(JSON.parse(held) as Reading, answered, JSON.parse(waiting) as Reading);
  }, [heard, held, waiting, answered, owner]);
  return null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
    list: async () => (await document.listRecoverable()).map(source => ({
      id: source.id, title, preview: JSON.stringify(source.record.checkpoint.draft, null, 2),
      discard: () => document.discardRecovery(source),
    })),
    recover: document.recover,
  });
  // Whether there is anything to say is the status's own rule (isSyncTrouble); it names the settings only then.
  // A copy for reading is not a failure: DeviceStorageNotice already says why above every page, and a
  // retry cannot wake the device storage — passed as an error it stood there as a dead button.
  return <DataSyncStatus subject={document.recoveryIdentity} title={title} className="my-3" status={document.status} error={document.error} errorWords={document.errorWords}
    onRetry={document.retry} onKeepLocal={document.keepLocal} onAcceptRemote={document.acceptRemote}
    recoveryChoices={recovery.choices} recoveryLoading={recovery.loading} recoveryError={recovery.error}
    onRecover={recovery.recover} onDiscardRecovery={recovery.discard} />;
}
