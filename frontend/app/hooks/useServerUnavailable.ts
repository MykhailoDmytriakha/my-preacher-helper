'use client';

import { useSyncExternalStore } from 'react';

import { useLasting } from '@/hooks/useLasting';
import { isServerUnavailable, subscribeToServerAvailability } from '@/utils/serverAvailability';

/** Whether our server's latest answer said it cannot give the person's data (`utils/serverAvailability`). */
export function useServerUnavailable(): boolean {
  return useSyncExternalStore(subscribeToServerAvailability, isServerUnavailable, () => false);
}

/** Whether the app-wide "server unavailable" line is said: once the refusal lasts, like "offline". */
export function useServerUnavailableShown(): boolean {
  return useLasting(useServerUnavailable());
}
