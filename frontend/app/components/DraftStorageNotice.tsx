'use client';

import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { isDraftStorageRefused, subscribeDraftStorage } from '@/utils/durableDraft';

/**
 * ONE PLACE SAYS THAT UNSAVED TEXT HAS NO SAFETY NET (BUG-20260815-durable-draft-fails-silently-when-storage-refuses).
 *
 * Every editor keeps a copy of unsaved text on the device in case the page closes. When the browser
 * refuses that copy (private mode, no room left), the editors keep working and only this notice
 * speaks — once, for all of them, until a copy lands again.
 */
export function DraftStorageNotice() {
  const { t } = useTranslation();
  const refused = useSyncExternalStore(subscribeDraftStorage, isDraftStorageRefused, () => false);
  if (!refused) return null;
  return (
    <section role="status" aria-labelledby="draft-storage-title" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <h2 id="draft-storage-title" className="font-medium text-amber-950 dark:text-amber-100">{t('draftStorage.title')}</h2>
      <p className="mt-0.5 text-amber-900/80 dark:text-amber-100/70">{t('draftStorage.body')}</p>
    </section>
  );
}
