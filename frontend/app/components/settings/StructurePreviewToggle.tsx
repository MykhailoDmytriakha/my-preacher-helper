'use client';

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import SettingsToggleRow from '@/components/settings/SettingsToggleRow';
import { useAuth } from '@/hooks/useAuth';
import { useUserSettings } from '@/hooks/useUserSettings';
import { awaitAcceptance } from '@/utils/recoverableWrite';

export default function StructurePreviewToggle() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const { settings, loading, updateStructurePreviewAccess } = useUserSettings(user?.uid);

  useEffect(() => {
    if (!user?.uid) {
      setEnabled(false);
      setHasLoaded(true);
    } else if (!loading) {
      setEnabled(settings?.enableStructurePreview || false);
      setHasLoaded(true);
    }
  }, [user?.uid, settings, loading]);

  const handleToggle = async () => {
    if (!user?.uid) return;

    // Queued acceptance means the refusal comes LATE; a no-op there hides it.
    const previous = enabled;
    const reportFailure = (error: unknown) => {
      console.error('❌ StructurePreviewToggle: Error updating setting:', error);
      // Message comes from the shared recovery toast; restore the switch only.
      setEnabled(previous);
    };

    try {
      const newValue = !enabled;
      await awaitAcceptance(updateStructurePreviewAccess(newValue), reportFailure);
      setEnabled(newValue);
    } catch (error) {
      reportFailure(error);
    }
  };

  return (
    <SettingsToggleRow
      title={t('settings.structurePreview.title')}
      description={t('settings.structurePreview.description')}
      enabled={enabled}
      onToggle={handleToggle}
      loading={loading && !hasLoaded}
      testId="structure-preview"
    />
  );
}
