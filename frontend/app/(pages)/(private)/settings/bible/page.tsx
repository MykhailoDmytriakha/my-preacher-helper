'use client';


import CrossReferenceSettings from '@/components/settings/CrossReferenceSettings';
import MineSettings from '@/components/settings/MineSettings';
import PlaceTrailSettings from '@/components/settings/PlaceTrailSettings';
import { useTranslation } from '@locales/useTranslation';

/** The Bible reader's settings (the owner, 2026-10-20: out of the "T", which is about the text), kept in the account (2026-11-02). */
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
