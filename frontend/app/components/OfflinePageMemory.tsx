'use client';

import { useEffect } from 'react';

import { OFFLINE_PAGE_SEEN } from '@/utils/offlineRscNavigation';

/**
 * Tells the service worker which pages the person has seen, so it keeps them for offline
 * navigation (BUG-20260927-offline-navigation-reloads-whole-app). The page says it, not the
 * traffic: a navigation served from Next's prefetch sends no request. It is said on every
 * committed address, again when a worker takes control (the first page loads before one does),
 * and again when the network returns or the app comes back to the screen: a warm-up tried
 * without network failed, and the worker keeps nothing about it. A page already kept costs
 * the worker one cache look-up.
 */
export function OfflinePageMemory({ address }: { address: string }) {
  useEffect(() => {
    const workers = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
    if (!workers) return;
    const tell = () => workers.controller?.postMessage({ type: OFFLINE_PAGE_SEEN, url: window.location.href });
    const tellWhenVisible = () => { if (document.visibilityState === 'visible') tell(); };
    tell();
    workers.addEventListener('controllerchange', tell);
    window.addEventListener('online', tell);
    document.addEventListener('visibilitychange', tellWhenVisible);
    return () => {
      workers.removeEventListener('controllerchange', tell);
      window.removeEventListener('online', tell);
      document.removeEventListener('visibilitychange', tellWhenVisible);
    };
  }, [address]);
  return null;
}
