import { useSyncExternalStore } from 'react';

import { getConnectivityStatus, getDeviceOnline, subscribeToConnectivity } from '@/utils/connectivity';

/**
 * ARE WE ONLINE — READ, NOT RE-DERIVED.
 *
 * This hook used to compute its own answer, `navigator.onLine && getConnectivityStatus()`,
 * in each of the ~25 components that call it, each with its own pair of window listeners.
 * That is not one detector shared by many readers; it is the same formula written many
 * times, and it disagreed with itself in two ways that reached users:
 *
 *  - the device half and the request half were combined HERE, so `apiClient` — which every
 *    other part of the app reads directly — never learned the device had gone offline, and
 *    kept answering `true` for a whole disconnected session;
 *  - multiplying by `navigator.onLine` on every notification meant a successful probe could
 *    not get us back online while that flag was stuck false, which happens to a PWA resumed
 *    from the background on iPadOS. The manual "check again" button then could never
 *    recover, because its answer was ANDed away.
 *
 * Both halves now live in `utils/connectivity`, which keeps them apart — the device signal
 * and the server signal have different evidence and different consumers — and derives the
 * single boolean the screens need. This is a subscription to that.
 *
 * WHY `useSyncExternalStore` AND NOT `useState` PLUS AN EFFECT. The obvious version reads
 * the value during render and subscribes afterwards, which leaves a window: a device that
 * drops its network between those two moments changes the store while nobody is listening,
 * and the screen keeps the stale answer until the next transition — in exactly the startup
 * moment this work is about. Re-reading inside the effect to close that window is what
 * caused a render loop in a modal. This is the API built for the problem: React reads the
 * snapshot itself, on every render and again right after subscribing, and bails out when
 * the value has not changed.
 */
const subscribe = (onStoreChange: () => void) => subscribeToConnectivity(onStoreChange);

/** The server has no connection state; rendering "offline" there would flash on hydration. */
const getServerSnapshot = () => true;

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getConnectivityStatus, getServerSnapshot);
}

/**
 * Does the DEVICE have a network — a narrower question than "is the app usable".
 *
 * The freshness banner needs exactly this one. It steps aside offline because the
 * crossed-out Wi-Fi icon already carries the message, and that reasoning holds only for a
 * device with no network. Using the app-wide boolean would silence it for a different
 * situation entirely: one request timing out marks the SERVER unreachable while Wi-Fi and
 * Firestore are fine, and the person would lose the specific warning that what they are
 * editing may be stale.
 */
export function useDeviceOnline(): boolean {
  return useSyncExternalStore(subscribe, getDeviceOnline, getServerSnapshot);
}
