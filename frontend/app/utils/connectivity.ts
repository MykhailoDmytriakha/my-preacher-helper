import { debugLog } from '@/utils/debugMode';

/**
 * IS THERE A CONNECTION — YES OR NO, AND THE LAST REAL REQUEST DECIDES.
 *
 * Yes: the last real request to our server reached it. No: it did not. That is the whole state
 * (owner's decision 2026-10-10, BUG-20260908-cached-response-counts-as-live-connection).
 *
 * The version this replaces kept the device and the server apart, held an "unknown", waited three
 * seconds before believing a recovery, ordered evidence by request start and gave the manual check
 * a status of its own. Every one of those was added to repair the previous one, and each brought a
 * way to get stuck: a late failure overruled a fresh success, a single timed-out probe left the app
 * offline over a working network, a recovery waited for quiet that never came. They are gone:
 *
 *   - any HTTP answer, a 503 included, is "yes": the request reached our server;
 *   - a network error or our timeout is "no" — unless the request started before the latest success,
 *     because then the success already describes a later moment than the failure does;
 *   - a success is never set aside: whenever it arrives, the server has just answered;
 *   - the phone saying "no network" (its `offline` event, or a re-read on the way back into the page
 *     that finds the flag turned false) is "no". The phone saying "network again" is NOT "yes" — a
 *     joined café Wi-Fi is not our server — it only makes the app ask (`connectivityKnock.ts`).
 *     A flag that stays false while requests get through (an iPad resumed from the background) does
 *     not keep re-flipping the answer: only a CHANGE of the flag is the phone saying something.
 *
 * Losing the connection is learned from the first request that does not reach. Getting it back can
 * only be learned by asking, which is the knock's job; this module just records outcomes.
 *
 * Nothing here runs at import: listeners are attached when the first subscriber arrives and dropped
 * when the last one leaves, which keeps the module inert during server rendering.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
/**
 * Told when the phone's own flag changes, whether or not the answer moves: what reads `isKnownOffline`
 * needs it. Kept apart because `listeners` hear only a CHANGE of the answer — the knock times its
 * first ask from the moment "no" began (`connectivityKnock.ts`), and a repeated "no" would move it.
 */
const phoneListeners = new Set<Listener>();

/**
 * HAS THE BROWSER SAID, RIGHT NOW, THAT THERE IS NO NETWORK?
 *
 * A fresh read for the write paths that decide whether to queue a write instead of sending it —
 * "queue only when we KNOW we cannot send". It is not the answer to "is there a connection"; that is
 * `getConnectivityStatus`, which the phone's flag can only move by changing.
 */
export const isBrowserOffline = (): boolean =>
  typeof navigator !== 'undefined' && navigator.onLine === false;

let online = true;
/** The state has not been anchored to this environment yet; `online` is a placeholder. */
let anchored = false;
/** The phone's flag as last read, so a re-read can tell a change from a flag that is simply stuck. */
let phoneOnline = true;

let requestSequence = 0;
/** Start sequence of the latest request that reached the server. */
let lastSuccessSequence = 0;

/** Taken when a request STARTS: a failure is weighed against the successes that began after it. */
export const beginConnectivityRequest = (): number => ++requestSequence;

const anchor = () => {
  if (anchored || typeof navigator === 'undefined') return;
  anchored = true;
  phoneOnline = !isBrowserOffline();
  online = phoneOnline;
};

const set = (next: boolean, why: string) => {
  if (online === next) return;
  online = next;
  debugLog('connectivity: changed', { online, why });
  listeners.forEach((listener) => listener());
};

/** A request got an answer — any status: the network carried it to our server and back. */
export const reportServerReachable = (requestId = beginConnectivityRequest()) => {
  anchor();
  lastSuccessSequence = Math.max(lastSuccessSequence, requestId);
  set(true, 'reached');
};

/** A request did not reach: network error, refused, dropped, or our own timeout. */
export const reportServerUnreachable = (requestId = beginConnectivityRequest()) => {
  anchor();
  if (requestId < lastSuccessSequence) return;
  set(false, 'not reached');
};

/** The phone's flag as heard now; a change is told to `phoneListeners`. Returns whether it changed. */
const hearPhone = (now: boolean): boolean => {
  if (phoneOnline === now) return false;
  phoneOnline = now;
  phoneListeners.forEach((listener) => listener());
  return true;
};

/** Read the phone's flag; only a change is news, and only a change to "no network" moves the answer. */
const readPhone = () => {
  if (hearPhone(!isBrowserOffline()) && !phoneOnline) set(false, 'phone offline');
};

const handlePhoneOffline = () => {
  hearPhone(false);
  set(false, 'phone offline');
};
const handlePhoneOnline = () => { hearPhone(true); };
/**
 * A page frozen in the background may have slept through the `offline` event; the flag is re-read on
 * the way back in. (Coming back the other way is the knock's business: it asks the server.)
 */
const handleReturn = () => {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') readPhone();
};

const attach = () => {
  if (typeof window === 'undefined') return;
  window.addEventListener('offline', handlePhoneOffline);
  window.addEventListener('online', handlePhoneOnline);
  window.addEventListener('focus', handleReturn);
  window.addEventListener('pageshow', handleReturn);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleReturn);
};

const detach = () => {
  if (typeof window === 'undefined') return;
  window.removeEventListener('offline', handlePhoneOffline);
  window.removeEventListener('online', handlePhoneOnline);
  window.removeEventListener('focus', handleReturn);
  window.removeEventListener('pageshow', handleReturn);
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleReturn);
};

/** The one answer: did the last real request reach our server? */
export const getConnectivityStatus = (): boolean => {
  anchor();
  return online;
};

/**
 * DO WE KNOW THAT THE SERVER CANNOT BE REACHED?
 *
 * Yes when the phone says "no network" and no request has reached our server since. This is what
 * the phone's flag used to answer alone for every decision that is not a write queue: how long a read
 * waits and whether it takes the server road, whether a step only the server can do (an AI call, a
 * one-shot settings write) is refused at once, whether a message says "offline". A flag stuck at false
 * while requests get through (an iPad resumed from the background) is not "offline"; and a failed
 * request while the phone says "network" does not switch reading or a step off — the next attempt is
 * what finds the server again (owner's rule 3, BUG-20260908-cached-response-counts-as-live-connection;
 * BUG-20261011-raw-phone-flag-in-read-paths). Writes that choose a durable queue keep `isBrowserOffline`.
 */
export const isKnownOffline = (): boolean => isBrowserOffline() && !getConnectivityStatus();

const nobodyListens = () => listeners.size === 0 && phoneListeners.size === 0;

const subscribe = (to: Set<Listener>, listener: Listener): (() => void) => {
  const first = nobodyListens();
  to.add(listener);
  if (first) {
    anchor();
    attach();
    // Attaching is also the moment to notice a transition slept through while nobody listened.
    readPhone();
  }
  return () => {
    to.delete(listener);
    if (nobodyListens()) detach();
  };
};

/** Told when the answer changes. */
export const subscribeToConnectivity = (listener: Listener): (() => void) => subscribe(listeners, listener);

/** Told when the phone's own flag changes, the answer moving or not — for what reads `isKnownOffline`. */
export const subscribeToPhoneFlag = (listener: Listener): (() => void) => subscribe(phoneListeners, listener);

/** Test seam: drop every listener and return to a pristine, unread state. */
export const __resetConnectivityForTests = () => {
  listeners.clear();
  phoneListeners.clear();
  detach();
  online = true;
  anchored = false;
  phoneOnline = true;
  requestSequence = 0;
  lastSuccessSequence = 0;
};
