'use client';

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import SettingsToggleRow from '@/components/settings/SettingsToggleRow';
import { useAuth } from '@/hooks/useAuth';
import { useUserSettings } from '@/hooks/useUserSettings';
import { awaitAcceptance } from '@/utils/recoverableWrite';

/**
 * Toggle component for enabling/disabling the audio generation beta feature.
 * Displays in the Settings page under User Settings section.
 */
export default function AudioGenerationToggle() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const { settings, loading, updateAudioGenerationAccess } = useUserSettings(user?.uid);

  useEffect(() => {
    if (!user?.uid) {
      setEnabled(false);
      setHasLoaded(true);
    } else if (!loading) {
      setEnabled(settings?.enableAudioGeneration || false);
      setHasLoaded(true);
    }
  }, [user?.uid, settings, loading]);

  const handleToggle = async () => {
    if (!user?.uid) return;

    // A settings write is accepted by the durable queue at once, so a REFUSAL
    // always arrives LATE. A no-op there would swallow it: the switch stays
    // flipped while the server refused, and nobody is told.
    const previous = enabled;
    const reportFailure = (error: unknown) => {
      console.error('AudioGenerationToggle: Error updating setting:', error);
      // Message comes from the shared recovery toast; restore the switch only.
      setEnabled(previous);
    };

    try {
      const newValue = !enabled;
      await awaitAcceptance(updateAudioGenerationAccess(newValue), reportFailure);
      setEnabled(newValue);
    } catch (error) {
      reportFailure(error);
    }
  };

  return (
    <SettingsToggleRow
      title={t('settings.audioGeneration.title', { defaultValue: 'Sermon Audio Generation (Beta)' })}
      description={t('settings.audioGeneration.description', { defaultValue: 'Enable experimental audio generation for sermons' })}
      enabled={enabled}
      onToggle={handleToggle}
      loading={loading && !hasLoaded}
      testId="audio-generation"
    />
  );
}
