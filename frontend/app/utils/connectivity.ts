import { debugLog } from '@/utils/debugMode';

/**
 * ARE WE ONLINE — TWO QUESTIONS, KEPT APART.
 *
 * "The device has a usable network" and "our server answered" are different propositions,
 * with different evidence and different consumers. Firestore's offline queue and every
 * `navigator.onLine` check in the write paths care about the first; React Query gating and
 * the AI controls care about the second.
 *
 * Collapsing them into one boolean is what made the original defect and then resisted
 * repair. The transport module owned the flag, so it started at "online" and moved only
 * when a request failed — and a session launched with the Wi-Fi off issues no requests, so
 * the app cheerfully reported a connection for the entire disconnected session: no offline
 * icon, no strip, while a separate mechanism that DID ask the device put a diagnostic panel
 * on screen instead. Two answers to one question, and the wrong one was the visible one.
 *
 * Repairs on top of the collapsed flag each needed a compensating mechanism — a recovery
 * debounce, a way to bypass that debounce, a probe fired on the browser's `online` event —
 * and every one of them introduced a way to get stuck: a probe that failed once could
 * disable all reads with nothing left to re-enable them; a bypass could overwrite a
 * disconnection that landed while it was in flight. Keeping the two fields apart removes
 * the need for all three, so they are gone.
 *
 * WHAT MAY MOVE EACH FIELD:
 *   device  — the browser's own signal, plus a re-read whenever the page becomes visible
 *             again. That re-read matters: an installed app frozen in the background can
 *             miss the `offline` event entirely, and without it the app would believe a
 *             connection it lost hours ago.
 *   server  — only the outcome of a real request. A joined network is not a reachable
 *             server, which is why a captive portal must not clear the offline icon.
 *
 * Nothing here runs at import: listeners are attached when the first subscriber arrives and
 * dropped when the last one leaves. That keeps the module inert during server rendering and
 * makes it testable without re-importing it.
 */
export type ServerReachability = 'unknown' | 'reachable' | 'unreachable';

interface ConnectivityState {
  device: boolean;
  server: ServerReachability;
}

type Listener = () => void;

const listeners = new Set<Listener>();

const readDevice = (): boolean =>
  typeof navigator === 'undefined' || navigator.onLine !== false;

let state: ConnectivityState = { device: true, server: 'unknown' };
/** The device has not been read yet in this environment, so `state.device` is a placeholder. */
let deviceRead = false;

/**
 * One boolean for the screens: is the app usable right now?
 *
 * A device with no network is offline whatever the server last said. A device with a
 * network is offline only once a request has actually failed — an unproven server is not a
 * broken one, or every cold start would flash the offline icon before its first request.
 */
const isOnlineFrom = ({ device, server }: ConnectivityState): boolean => {
  /**
   * A request that genuinely came back outranks the device flag. An installed app resumed
   * from the background on iPadOS can report `navigator.onLine === false` over a working
   * network, and without this the app could never come back from that: the manual "check
   * again" button would confirm a reachable server and still be overruled by a flag that
   * is simply wrong.
   */
  if (server === 'reachable') return true;
  return device && server !== 'unreachable';
};

let publishedState: ConnectivityState = state;
let publishedIsOnline = isOnlineFrom(state);

/**
 * Subscribers are told when EITHER field moves, not only when the derived boolean does.
 *
 * The device losing its network while a request had already proven the server keeps the
 * single boolean at `true` — but a screen that needs to know specifically whether the
 * DEVICE is offline, as the freshness banner does, would never be re-rendered. Readers that
 * only care about the boolean lose nothing: `useSyncExternalStore` compares snapshots and
 * skips a render when the value it reads is unchanged.
 */
const publish = () => {
  if (state.device === publishedState.device && state.server === publishedState.server) return;
  publishedState = state;
  publishedIsOnline = isOnlineFrom(state);
  debugLog('connectivity: changed', { ...state, isOnline: publishedIsOnline });
  listeners.forEach((listener) => listener());
};

const setDevice = (device: boolean) => {
  if (state.device === device) return;
  // A device transition settles the question by itself; a half-finished recovery is stale.
  cancelPendingRecovery();
  /**
   * Losing the network invalidates what we knew about the server. Keeping `reachable`
   * across a disconnection is how an app comes back from airplane mode still believing it
   * can reach everything, and re-runs work that will fail.
   */
  /**
   * A device transition invalidates everything we knew about the server, both ways.
   *
   * Carrying `reachable` across a disconnection is how an app comes back from airplane mode
   * still believing it can reach everything. Carrying `unreachable` is worse and less
   * obvious: a request that began before the network died rejects LATE, after the offline
   * event, and marks the server unreachable while we are already offline — and that verdict
   * then survives the reconnection and keeps every server-first read disabled over a
   * perfectly good connection, with nothing running that could disprove it.
   */
  state = { device, server: 'unknown' };
  publish();
};

/**
 * Coming back is confirmed slowly; going away is believed at once.
 *
 * On a shaky link — a train, a lift, a moving car — successes and failures alternate, and
 * publishing every success immediately would flash the offline icon on and off and let the
 * AI controls enable between two failures. So a recovery waits for a few quiet seconds
 * before it counts, and any failure in that window cancels it. A loss needs no such wait:
 * being told late that you are offline is the failure this whole area exists to prevent.
 */
const RECOVERY_SETTLE_MS = 3000;
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;

const cancelPendingRecovery = () => {
  if (recoveryTimer) {
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
  }
};

/**
 * A request came back — whatever its status, the network carried it.
 *
 * ⚠️ NOT WHILE THE DEVICE SAYS THERE IS NO NETWORK. An installed app serves same-origin
 * GETs from Cache Storage when offline, and those replies are indistinguishable here from
 * real ones. Recording them would do damage twice: once now, and once later, because a
 * `reachable` earned offline survives into the next reconnection and lets a captive portal
 * clear the offline icon with nothing having been reached.
 *
 * The way back from a device flag that is simply stuck is `reportProbeSucceeded`, which a
 * person triggers deliberately and which cannot be served from the cache.
 */
export const reportServerReachable = () => {
  if (state.server === 'reachable' || recoveryTimer) return;
  if (!state.device) return;
  if (isOnlineFrom(state)) {
    // Nothing to settle: the screens already say we are online.
    state = { ...state, server: 'reachable' };
    publish();
    return;
  }
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null;
    state = { ...state, server: 'reachable' };
    publish();
  }, RECOVERY_SETTLE_MS);
};

/**
 * An EXPLICIT check reached the server — the person pressed "check again" and it answered.
 *
 * This is the one piece of evidence allowed to overrule the device flag, and it is safe to
 * because of how it is obtained: a HEAD request the service worker does not cache, made
 * because someone asked for it. It settles at once — a person standing there waiting is not
 * a flapping link, and making them watch a crossed-out icon after being told the connection
 * is back is the toast lying.
 */
export const reportProbeSucceeded = () => {
  cancelPendingRecovery();
  if (state.server === 'reachable') return;
  /**
   * Only the SERVER field moves. Writing `device: true` here would have the store assert
   * something it did not observe, and the write paths that read `navigator.onLine` directly
   * would go on disagreeing with it — so the app would claim a connection while a save was
   * quietly being queued. `isOnlineFrom` already lets proven reachability outrank the flag.
   */
  state = { ...state, server: 'reachable' };
  publish();
};

/** A request could not reach the server: timeout, DNS, refused, dropped mid-flight. */
export const reportServerUnreachable = () => {
  cancelPendingRecovery();
  if (state.server === 'unreachable') return;
  state = { ...state, server: 'unreachable' };
  publish();
};

const syncDevice = () => setDevice(readDevice());

const handleDeviceOffline = () => setDevice(false);
const handleDeviceOnline = () => setDevice(true);
/**
 * A page that was frozen in the background may have missed the transition entirely, so the
 * answer is re-read on the way back in rather than trusted from before the freeze.
 */
const handleVisibility = () => {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') syncDevice();
};

const attach = () => {
  if (typeof window === 'undefined') return;
  /**
   * Whatever we knew about the server belongs to a period we were not watching. The network
   * may have dropped and returned entirely while no screen was mounted, and carrying an old
   * `reachable` across that gap would let the app claim a connection it has not tested.
   */
  state = { ...state, server: 'unknown' };
  publish();
  window.addEventListener('offline', handleDeviceOffline);
  window.addEventListener('online', handleDeviceOnline);
  window.addEventListener('focus', handleVisibility);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility);
  }
};

const detach = () => {
  // A recovery still settling belongs to the period we were watching; letting its timer
  // fire after a gap would publish "online" on evidence nobody was there to check.
  cancelPendingRecovery();
  if (typeof window === 'undefined') return;
  window.removeEventListener('offline', handleDeviceOffline);
  window.removeEventListener('online', handleDeviceOnline);
  window.removeEventListener('focus', handleVisibility);
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibility);
  }
};

/**
 * The current answer. Reading it is also what first anchors `device` to reality — before
 * anyone has asked, there is nothing to be wrong about, and doing this lazily keeps the
 * module inert on the server.
 */
export const getConnectivityStatus = (): boolean => {
  if (!deviceRead && typeof navigator !== 'undefined') {
    deviceRead = true;
    state = { ...state, device: readDevice() };
    publishedState = state;
    publishedIsOnline = isOnlineFrom(state);
  }
  return publishedIsOnline;
};

/** Does the DEVICE have a network? Not the same question as "is the app usable". */
export const getDeviceOnline = (): boolean => {
  getConnectivityStatus();
  return state.device;
};

/** For diagnostics and tests: the two fields behind the single boolean. */
export const getConnectivityState = (): Readonly<ConnectivityState> => {
  getConnectivityStatus();
  return state;
};

export const subscribeToConnectivity = (listener: Listener): (() => void) => {
  // Registered BEFORE attaching, because attaching resets what we believed about the
  // server and can change the answer — and the screen that just arrived is exactly who
  // needs to hear about it.
  const first = listeners.size === 0;
  listeners.add(listener);
  if (first) {
    attach();
    // Attaching is also the moment to make sure we did not sleep through a transition.
    getConnectivityStatus();
    syncDevice();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detach();
  };
};

/** Test seam: drop every listener and return to a pristine, unread state. */
export const __resetConnectivityForTests = () => {
  listeners.clear();
  cancelPendingRecovery();
  detach();
  state = { device: true, server: 'unknown' };
  publishedState = state;
  deviceRead = false;
  publishedIsOnline = true;
};
