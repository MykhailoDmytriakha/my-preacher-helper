import { apiClient } from '@/utils/apiClient';
import { getConnectivityStatus, subscribeToConnectivity } from '@/utils/connectivity';
import { debugLog } from '@/utils/debugMode';

/**
 * KNOCKING — HOW THE APP LEARNS THE CONNECTION IS BACK.
 *
 * Losing the connection shows itself: the first request that does not reach. Getting it back does
 * not — the server returning and the server still gone look the same until somebody asks. So while
 * the answer is "no" and the screen is open, the app asks: an ordinary HEAD `/api/health` through
 * `apiClient`, whose outcome counts like any request's (`utils/connectivity.ts`). The first answer
 * is "yes" and the knocking stops (owner's decision 2026-10-10, rule 4).
 *
 *   - one budget: no knock starts sooner than the current gap after the previous one — 2, 4, 8,
 *     16 s, then 30 s — so a page left open on a dead network asks at most twice a minute once the
 *     first minute is over, however much the person taps or types meanwhile;
 *   - the schedule knocks when the gap has passed; the return to the page and any action of the
 *     person knock at once if it has (the moments the answer is most wanted); the phone's `online`
 *     event (hidden or not) and the "check again" button knock regardless — they are rare and asked;
 *   - never while the answer is "yes", never on schedule in a hidden tab, one knock in flight. The
 *     ceiling is per visible tab: a hidden one does not knock on its own.
 *
 * A knock that fails is just one more "no". The previous knock (2026-09-30) broke because of what
 * surrounded it, not because it asked: a late failure overruled a fresh success, it bypassed a
 * three-second settle, and its 3 s deadline could not restore a network answering in 4 s. The state
 * module now keeps none of those, and the knock uses the ordinary timeout.
 */

export type KnockOutcome = 'reached' | 'reached-with-error' | 'unreachable';

const LADDER_MS = [2000, 4000, 8000, 16000];
const STEADY_MS = 30000;
const ACTION_EVENTS = ['pointerdown', 'keydown'] as const;

let inFlight: Promise<KnockOutcome> | null = null;
let users = 0;
/** How many knocks this stretch of "no" has made — picks the gap before the next one. */
let step = 0;
/** When the last knock started (or the stretch of "no" began). */
let lastKnockAt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let stopListening: (() => void) | null = null;

const gap = () => (step < LADDER_MS.length ? LADDER_MS[step] : STEADY_MS);
const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

const ask = (): Promise<KnockOutcome> => {
  if (inFlight) return inFlight;
  inFlight = apiClient('/api/health', {
    method: 'HEAD',
    category: 'health',
    // From the network every time: a stored answer would announce a connection that reached nothing.
    cache: 'no-store',
  })
    .then((response): KnockOutcome => (response.ok ? 'reached' : 'reached-with-error'))
    .catch((): KnockOutcome => 'unreachable')
    .finally(() => { inFlight = null; });
  return inFlight;
};

const clearTimer = () => {
  if (timer) clearTimeout(timer);
  timer = null;
};

/** Knock, count it against the budget, and put the next scheduled one on the clock. */
const knock = (why: string): Promise<KnockOutcome> => {
  if (inFlight) return inFlight;
  lastKnockAt = Date.now();
  step += 1;
  clearTimer();
  debugLog('connectivity knock', { why, step });
  return ask().finally(schedule);
};

/** Put the next scheduled knock on the clock — only while "no", visible and somebody needs it. */
function schedule() {
  if (timer || users === 0 || getConnectivityStatus() || !visible()) return;
  const wait = Math.max(0, lastKnockAt + gap() - Date.now());
  timer = setTimeout(() => {
    timer = null;
    if (!getConnectivityStatus() && visible()) void knock('scheduled');
  }, wait);
}

/** A moment the answer is most wanted: knock now if the budget allows, else the schedule covers it. */
const whenAllowed = (why: string) => {
  if (users === 0 || getConnectivityStatus() || inFlight) return;
  if (Date.now() - lastKnockAt < gap()) return;
  void knock(why);
};

/**
 * Ask the server now — the "check again" button. Shares the knock already in flight, and resolves
 * with what the person can be told: reached, reached but the server answered with an error, or not
 * reached at all.
 */
export function knockNow(): Promise<KnockOutcome> {
  return users > 0 ? knock('asked') : ask();
}

const onConnectivity = () => {
  if (getConnectivityStatus()) {
    clearTimer();
    step = 0;
    return;
  }
  // A stretch of "no" starts with the request that just failed: the first knock comes a gap later.
  if (step === 0 && !inFlight) lastKnockAt = Date.now();
  schedule();
};

const onPhoneOnline = () => {
  if (users > 0 && !getConnectivityStatus()) void knock('phone online');
};
const onReturn = () => {
  if (!visible()) {
    clearTimer();
    return;
  }
  whenAllowed('return');
  schedule();
};
const onAction = () => whenAllowed('action');

/** Start knocking whenever the answer is "no". Returns the stop; the last stop ends it. */
export function startConnectivityKnock(): () => void {
  users += 1;
  if (users === 1 && typeof window !== 'undefined') {
    const unsubscribe = subscribeToConnectivity(onConnectivity);
    window.addEventListener('online', onPhoneOnline);
    window.addEventListener('focus', onReturn);
    window.addEventListener('pageshow', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    for (const type of ACTION_EVENTS) window.addEventListener(type, onAction, { capture: true, passive: true });
    stopListening = () => {
      unsubscribe();
      window.removeEventListener('online', onPhoneOnline);
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('pageshow', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
      for (const type of ACTION_EVENTS) window.removeEventListener(type, onAction, { capture: true });
    };
    onConnectivity();
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    users -= 1;
    if (users > 0) return;
    clearTimer();
    step = 0;
    stopListening?.();
    stopListening = null;
  };
}

/** Test seam. */
export const __resetConnectivityKnockForTests = () => {
  clearTimer();
  stopListening?.();
  stopListening = null;
  users = 0;
  step = 0;
  lastKnockAt = 0;
  inFlight = null;
};
