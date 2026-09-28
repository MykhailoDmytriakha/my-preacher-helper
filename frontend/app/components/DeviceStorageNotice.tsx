'use client';

import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { ENGINE_STORAGE, getDeviceStorageHealth, subscribeDeviceStorage, type DeviceStorageHealth } from '@/utils/deviceStorage';

const QUIET: DeviceStorageHealth = { silent: [] };
const engineStorage: readonly string[] = ENGINE_STORAGE;

/**
 * ONE PLACE SAYS WHY (BUG-20260927-engine-open-hangs-on-silent-device-storage).
 *
 * While the engine's storage on this device does not answer, every record on the screen is a copy
 * for reading and every change is refused. The screens only refuse; this notice explains once, for
 * all of them, in words a pastor in the middle of a meeting can act on — and it tells him that
 * reloading will not help, because it will not.
 */
export function DeviceStorageNotice() {
  const { t } = useTranslation();
  const health = useSyncExternalStore(subscribeDeviceStorage, getDeviceStorageHealth, () => QUIET);
  if (!health.silent.some(entry => engineStorage.includes(entry.database))) return null;
  return (
    <section role="status" aria-labelledby="device-storage-title" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <h2 id="device-storage-title" className="font-medium text-amber-950 dark:text-amber-100">{t('deviceStorage.title')}</h2>
      <p className="mt-0.5 text-amber-900/80 dark:text-amber-100/70">{t('deviceStorage.body')}</p>
    </section>
  );
}
