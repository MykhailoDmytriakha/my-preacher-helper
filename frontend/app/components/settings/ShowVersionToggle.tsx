'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingsToggleRow from '@/components/settings/SettingsToggleRow';
import { useAuth } from '@/hooks/useAuth';
import { useUserSettings } from '@/hooks/useUserSettings';
import { awaitAcceptance } from '@/utils/recoverableWrite';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME || '';

/**
 * Toggle for showing the deployed app version (build SHA + build time) in
 * Settings. Useful for confirming a redeploy actually landed in production.
 */
export default function ShowVersionToggle() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const { settings, loading, updateShowAppVersion, updatingShowAppVersion } = useUserSettings(user?.uid);

  useEffect(() => {
    if (!user?.uid) {
      setEnabled(false);
      setHasLoaded(true);
    } else if (!loading) {
      setEnabled(settings?.showAppVersion || false);
      setHasLoaded(true);
    }
  }, [user?.uid, settings, loading]);

  const handleToggle = async () => {
    // Ignore clicks while a write is in flight to avoid optimistic desync.
    if (!user?.uid || updatingShowAppVersion) return;

    const newValue = !enabled;
    setEnabled(newValue); // optimistic
    // The refusal for a queued settings write arrives LATE — reporting it only from
    // the catch would leave the switch flipped and the person uninformed.
    const reportFailure = (error: unknown) => {
      console.error('ShowVersionToggle: Error updating setting:', error);
      // Message comes from the shared recovery toast; restore the switch only.
      setEnabled(!newValue);
    };

    try {
      await awaitAcceptance(updateShowAppVersion(newValue), reportFailure);
    } catch (error) {
      reportFailure(error);
    }
  };

  const buildTimeLabel = BUILD_TIME ? new Date(BUILD_TIME).toLocaleString() : '';

  return (
    <SettingsToggleRow
      title={t('settings.showVersion.title', { defaultValue: 'Show app version' })}
      description={t('settings.showVersion.description', {
        defaultValue: 'Display the deployed build version in Settings (handy for confirming an update went live).',
      })}
      enabled={enabled}
      onToggle={handleToggle}
      loading={loading && !hasLoaded}
      testId="show-version"
    >
      {enabled && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/50">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
              {t('settings.showVersion.versionLabel', { defaultValue: 'Version' })}
            </span>
            <code className="rounded bg-gray-200 px-2 py-0.5 font-mono text-sm text-gray-800 dark:bg-gray-700 dark:text-gray-100">
              {APP_VERSION}
            </code>
          </div>
          {buildTimeLabel && (
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                {t('settings.showVersion.builtLabel', { defaultValue: 'Built' })}
              </span>
              <span className="font-mono text-xs text-gray-500 dark:text-gray-400" suppressHydrationWarning>
                {buildTimeLabel}
              </span>
            </div>
          )}
        </div>
      )}
    </SettingsToggleRow>
  );
}
