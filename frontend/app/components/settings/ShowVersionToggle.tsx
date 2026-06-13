'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/hooks/useAuth';
import { useUserSettings } from '@/hooks/useUserSettings';

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
    let isActive = true;

    if (!user?.uid) {
      if (isActive) {
        setEnabled(false);
        setHasLoaded(true);
      }
      return () => { isActive = false; };
    }

    if (loading) {
      return () => { isActive = false; };
    }

    if (isActive) {
      setEnabled(settings?.showAppVersion || false);
      setHasLoaded(true);
    }

    return () => { isActive = false; };
  }, [user?.uid, settings, loading]);

  const handleToggle = async () => {
    // Ignore clicks while a write is in flight to avoid optimistic desync.
    if (!user?.uid || updatingShowAppVersion) return;

    const newValue = !enabled;
    setEnabled(newValue); // optimistic
    try {
      await updateShowAppVersion(newValue);
    } catch (error) {
      console.error('ShowVersionToggle: Error updating setting:', error);
      setEnabled(!newValue); // revert on failure
    }
  };

  if (loading && !hasLoaded) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6">
        <div className="animate-pulse" data-testid="show-version-loading">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-4"></div>
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  const buildTimeLabel = BUILD_TIME ? new Date(BUILD_TIME).toLocaleString() : '';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('settings.showVersion.title', { defaultValue: 'Show app version' })}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {t('settings.showVersion.description', {
              defaultValue: 'Display the deployed build version in Settings (handy for confirming an update went live).',
            })}
          </p>
        </div>
        <button
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'}`}
          role="switch"
          aria-checked={enabled}
          data-testid="show-version-toggle"
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
          />
        </button>
      </div>

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
    </div>
  );
}
