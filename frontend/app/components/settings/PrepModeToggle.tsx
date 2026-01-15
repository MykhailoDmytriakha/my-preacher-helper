'use client';

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/hooks/useAuth';
import { useUserSettings } from '@/hooks/useUserSettings';

export default function PrepModeToggle() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const { settings, loading, updatePrepModeAccess } = useUserSettings(user?.uid);

  useEffect(() => {
    let isActive = true;

    if (!user?.uid) {
      console.log('❌ PrepModeToggle: no user.uid, skipping load');
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

    console.log('🔍 PrepModeToggle: loading settings for user:', user.uid);
    console.log('📊 PrepModeToggle: loaded settings:', settings);
    const enabledValue = settings?.enablePrepMode || false;
    console.log('✅ PrepModeToggle: setting enabled to:', enabledValue);
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
      console.log('❌ PrepModeToggle: handleToggle - no user.uid');
      return;
    }

    try {
      const newValue = !enabled;
      console.log('🔄 PrepModeToggle: toggling to:', newValue, 'for user:', user.uid);
      await updatePrepModeAccess(newValue);
      console.log('✅ PrepModeToggle: successfully updated setting');
      setEnabled(newValue);
    } catch (error) {
      console.error('❌ PrepModeToggle: Error updating prep mode:', error);
      alert('Failed to update setting');
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
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
          }`}
          role="switch"
          aria-checked={enabled}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
