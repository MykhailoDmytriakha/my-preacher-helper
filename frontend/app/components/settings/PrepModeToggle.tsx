'use client';

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/hooks/useAuth';
import { useUserSettings } from '@/hooks/useUserSettings';
import { awaitAcceptance } from '@/utils/recoverableWrite';

export default function PrepModeToggle() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const { settings, loading, updatePrepModeAccess } = useUserSettings(user?.uid);

  useEffect(() => {
    let isActive = true;

    if (!user?.uid) {
      if (isActive) {
        setEnabled(false);
        setHasLoaded(true);
      }
      return () => {
        isActive = false;
      };
    }

    if (loading) {
      return () => {
        isActive = false;
      };
    }

    const enabledValue = settings?.enablePrepMode || false;
    if (isActive) {
      setEnabled(enabledValue);
      setHasLoaded(true);
    }

    return () => {
      isActive = false;
    };
  }, [user?.uid, settings, loading]);

  const handleToggle = async () => {
    if (!user?.uid) {
      return;
    }

    const previous = enabled;
    // A settings write is owned by the durable queue, so acceptance arrives at once
    // and a REFUSAL arrives late. Handing the late failure to a no-op would swallow
    // it: the switch would stay flipped while the server refused the change, and the
    // person would be told nothing at all.
    const reportFailure = (error: unknown) => {
      console.error('❌ PrepModeToggle: Error updating prep mode:', error);
      // The refusal message comes from the shared recovery toast; here we only
      // restore what the person sees, so the switch never lies about the server.
      setEnabled(previous);
    };

    try {
      const newValue = !enabled;
      await awaitAcceptance(updatePrepModeAccess(newValue), reportFailure);
      setEnabled(newValue);
    } catch (error) {
      reportFailure(error);
    }
  };

  if (loading && !hasLoaded) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6">
        <div className="animate-pulse" data-testid="prep-mode-loading">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-4"></div>
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('settings.prepMode.title', { defaultValue: 'Preparation Mode (Beta)' })}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {t('settings.prepMode.description', {
              defaultValue: 'Enable access to the new preparation mode workflow'
            })}
          </p>
        </div>
        <button
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
            }`}
          role="switch"
          aria-checked={enabled}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
          />
        </button>
      </div>
    </div>
  );
}
