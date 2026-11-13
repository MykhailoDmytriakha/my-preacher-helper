import { getConnectivityStatus, subscribeToConnectivity } from '@/utils/connectivity';

/**
 * THE SERVER BACK IN REACH — THE MOMENT A READ THAT FAILED FOR WANT OF IT IS WORTH ASKING AGAIN.
 *
 * In reach: the app's one answer to "is there a connection" is yes (`utils/connectivity`) and the page
 * is in sight. A moment is counted each time this tab ENTERS that state: the answer turns to yes while
 * the page is visible, or the person comes back to the page while the answer is yes. It is the condition
 * the data engine reads a refused document again on (`engine.onceReachable`), kept here for the reads
 * that are not the engine's — the Bible's files (`hooks/useReadAgainWhenReachable`).
 *
 * The return to the page counts on its own because a request can die with no other sign: a phone that
 * slept kills what was on its way while the answer never left "yes". A hidden page counts as out of
 * reach: an attempt made there is likely to die the same death.
 *
 * Only moments are counted: nothing is asked here and nothing runs on a clock. Listeners are attached
 * with the first subscriber and dropped with the last, as in `utils/connectivity`; the count moves only
 * while somebody listens.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let moments = 0;
/** Whether the server was in reach when last looked at: a moment is the change to yes. */
let inReach = false;
let stopWatching: (() => void) | null = null;

const pageInSight = () => typeof document === 'undefined' || document.visibilityState === 'visible';

/** Can this tab ask the server right now — read fresh, as the engine asks `canRead` at the moment it acts. */
export const serverInReach = (): boolean => getConnectivityStatus() && pageInSight();

const look = () => {
  const now = serverInReach();
  const came = now && !inReach;
  inReach = now;
  if (!came) return;
  moments += 1;
  [...listeners].forEach((listener) => listener());
};

const watch = (): (() => void) => {
  inReach = serverInReach();
  const stopAnswer = subscribeToConnectivity(look);
  if (typeof window === 'undefined') return stopAnswer;
  // The three signs of a return the engine and `utils/connectivity` listen to: a tablet that wakes may give only one.
  document.addEventListener('visibilitychange', look);
  window.addEventListener('focus', look);
  window.addEventListener('pageshow', look);
  return () => {
    stopAnswer();
    document.removeEventListener('visibilitychange', look);
    window.removeEventListener('focus', look);
    window.removeEventListener('pageshow', look);
  };
};

/**
 * How many times the server has come back into reach. A read keeps the count it began at: a different
 * count when it fails means the server came back while that read was dying.
 */
export const reachableAgainCount = (): number => moments;

/** Told at every return of the server into reach. */
export function subscribeToReachableAgain(listener: Listener): () => void {
  if (listeners.size === 0) stopWatching = watch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stopWatching?.();
    stopWatching = null;
  };
}

/** Test seam: forget every listener and every moment. */
export const __resetReachableAgainForTests = () => {
  stopWatching?.();
  stopWatching = null;
  listeners.clear();
  moments = 0;
  inReach = false;
};
