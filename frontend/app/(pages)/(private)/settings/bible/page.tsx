'use client';

import { useTranslation } from 'react-i18next';

import CrossReferenceSettings from '@/components/settings/CrossReferenceSettings';
import MineSettings from '@/components/settings/MineSettings';
import PlaceTrailSettings from '@/components/settings/PlaceTrailSettings';

/** The Bible reader's settings (the owner, 2026-10-20: out of the "T", which is about the text), kept on this device. */
export default function BibleSettingsPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <CrossReferenceSettings />
      <MineSettings />
      <PlaceTrailSettings />
      <p className="px-1 text-sm text-gray-600 dark:text-gray-400">{t('settings.bible.device')}</p>
    </div>
  );
}
