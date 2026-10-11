import { useSyncExternalStore } from 'react';

import { getConnectivityStatus, subscribeToConnectivity } from '@/utils/connectivity';

/**
 * IS THERE A CONNECTION — READ, NOT RE-DERIVED.
 *
 * A subscription to `utils/connectivity`: did the last real request reach our server. The answer
 * SHOWS (the crossed-out Wi-Fi icon, a message); it does not switch reading, editing or saving off
 * (owner's rule 3, BUG-20260908-cached-response-counts-as-live-connection).
 *
 * WHY `useSyncExternalStore` AND NOT `useState` PLUS AN EFFECT. The obvious version reads the value
 * during render and subscribes afterwards, which leaves a window: a connection lost between those two
 * moments changes the store while nobody is listening, and the screen keeps the stale answer until
 * the next transition. Re-reading inside the effect to close that window caused a render loop in a
 * modal. This is the API built for the problem: React reads the snapshot itself, on every render and
 * again right after subscribing, and bails out when the value has not changed.
 */
const subscribe = (onStoreChange: () => void) => subscribeToConnectivity(onStoreChange);

/** The server has no connection state; rendering "offline" there would flash on hydration. */
const getServerSnapshot = () => true;

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getConnectivityStatus, getServerSnapshot);
}
