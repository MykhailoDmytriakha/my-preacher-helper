'use client';

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import SettingsToggleRow from '@/components/settings/SettingsToggleRow';
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
    if (!user?.uid) {
      setEnabled(false);
      setHasLoaded(true);
    } else if (!loading) {
      setEnabled(settings?.enablePrepMode || false);
      setHasLoaded(true);
    }
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

  return (
    <SettingsToggleRow
      title={t('settings.prepMode.title', { defaultValue: 'Preparation Mode (Beta)' })}
      description={t('settings.prepMode.description', { defaultValue: 'Enable access to the new preparation mode workflow' })}
      enabled={enabled}
      onToggle={handleToggle}
      loading={loading && !hasLoaded}
      testId="prep-mode"
    />
  );
}
