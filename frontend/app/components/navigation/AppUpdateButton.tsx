'use client';

import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Tooltip from '@/components/ui/Tooltip';

/**
 * "A NEWER VERSION OF THE APP IS READY" — as an available action, not an alarm.
 *
 * This replaces a toast that sat over the interface with `duration: Infinity` and
 * said "this updates THE PROGRAM ITSELF, not your records. Reload?". The words
 * frightened people more than the event does: "reload" reads as "something is about
 * to be lost", and it could appear mid-sentence while a thought was being dictated.
 *
 * Nothing about the update is urgent. It is simply something the person MAY do — so
 * it belongs where the other things they may do live: a small icon in the header,
 * present only while there is actually something to update, explaining itself on
 * hover.
 *
 * WHY A RELOAD IS UNAVOIDABLE HERE, unlike refreshing a record: the app's code is
 * already running in memory. Swapping running code for a new build is not something
 * a browser can do, and navigating inside the app does not help — those are not real
 * page loads, the same running program simply redraws the screen. The update does
 * arrive on its own the next time the app is opened from scratch; this button exists
 * so it can arrive TODAY instead.
 *
 * Fires only on a genuine UPDATE: the very first service worker install also claims
 * the page, and prompting then would ask people to reload into what they already
 * have.
 */
export function AppUpdateButton() {
  const { t } = useTranslation();
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const container = navigator.serviceWorker;
    const hadControllerAtBoot = Boolean(container.controller);

    const onControllerChange = () => {
      if (!hadControllerAtBoot) return;
      setUpdateReady(true);
    };

    container.addEventListener('controllerchange', onControllerChange);
    return () => container.removeEventListener('controllerchange', onControllerChange);
  }, []);

  if (!updateReady) return null;

  return (
    <Tooltip content={t('pwa.updateAvailable.hint')}>
      <button
        type="button"
        onClick={() => window.location.reload()}
        aria-label={t('pwa.updateAvailable.action')}
        data-testid="app-update-button"
        /* Same round pad as the offline indicator beside it, in the dark-on-light
           pairing the app already uses for tooltips — and the one the old update
           prompt's button had, so the thing being offered still looks like itself.
           An earlier attempt put a notification dot on a bare icon: it overlapped
           the arrow and read as a broken glyph rather than as a signal. */
        className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm transition-all duration-300 hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
      >
        {/* Heroicons, the set the rest of the header already draws from, rather than
            a hand-rolled arc: its rotation glyph carries a proper gap between the
            arrowhead and the start of the stroke, where the previous one nearly
            closed the circle and read as a smudge at this size. */}
        <ArrowPathIcon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
