import { useSyncExternalStore } from 'react';

import { isKnownOffline, subscribeToConnectivity, subscribeToPhoneFlag } from '@/utils/connectivity';

/*
 * A file of its own, beside `useOnlineStatus`: many tests replace that module whole, and a hook added
 * there turns undefined under every such mock.
 */

/** Either change moves `isKnownOffline`: the answer, or the phone's flag while the answer stays "no". */
const subscribeKnown = (onStoreChange: () => void) => {
  const stopAnswer = subscribeToConnectivity(onStoreChange);
  const stopPhone = subscribeToPhoneFlag(onStoreChange);
  return () => { stopPhone(); stopAnswer(); };
};

const getServerKnownOffline = () => false;

/** Does the phone say there is no network, with no request through since — `isKnownOffline`, kept current. */
export function useKnownOffline(): boolean {
  return useSyncExternalStore(subscribeKnown, isKnownOffline, getServerKnownOffline);
}
