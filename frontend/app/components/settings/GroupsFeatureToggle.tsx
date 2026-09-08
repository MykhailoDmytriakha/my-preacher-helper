'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingsToggleRow from '@/components/settings/SettingsToggleRow';
import { useAuth } from '@/hooks/useAuth';
import { useUserSettings } from '@/hooks/useUserSettings';
import { updateGroupsAccess } from '@/services/userSettings.service';

export default function GroupsFeatureToggle() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [updating, setUpdating] = useState(false);
  const { settings, loading, refresh } = useUserSettings(user?.uid);

  useEffect(() => {
    if (!user?.uid) {
      setEnabled(false);
      setHasLoaded(true);
    } else if (!loading) {
      setEnabled(settings?.enableGroups || false);
      setHasLoaded(true);
    }
  }, [user?.uid, settings, loading]);

  const handleToggle = async () => {
    if (!user?.uid || updating) return;

    try {
      setUpdating(true);
      const newValue = !enabled;
      await updateGroupsAccess(user.uid, newValue);
      await refresh();
      setEnabled(newValue);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('groups-feature-updated', { detail: newValue })
        );
      }
    } catch (error) {
      console.error('GroupsFeatureToggle: Error updating setting:', error);
      alert('Failed to update setting');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <SettingsToggleRow
      title={t('settings.groups.title', { defaultValue: 'Groups Workspace (Beta)' })}
      description={t('settings.groups.description', { defaultValue: 'Enable access to the Groups workspace and related navigation' })}
      enabled={enabled}
      onToggle={handleToggle}
      loading={loading && !hasLoaded}
      testId="groups-feature"
      disabled={updating}
    />
  );
}
