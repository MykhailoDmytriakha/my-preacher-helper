/**
 * CAN OUR SERVER GIVE THE PERSON'S DATA RIGHT NOW? (BUG-20261019-outage-said-as-two-check-lines)
 *
 * A different question from `connectivity.ts`. There, any answer — a 503 included — means "the
 * connection is there" (owner's rule 2), and reading and sending follow that answer. Here the store's
 * refusal means the other half: our server answered, but could not reach the people's data (the database's
 * daily quota spent, or the database silent — `services/storeAvailability.server.ts`). Every screen
 * used to guess this from its own failed check and said it in two technical lines, twice on one page,
 * so the owner took it for "offline". Now the app knows it once, and one line says it
 * (`OfflineBanner`); nothing here switches reading or sending off.
 *
 * Yes when our server's latest answer was the store's refusal — a 503 carrying `Retry-After`, which
 * only `services/storeAvailability.server.ts` sends; another 503 (say, "admin access is not
 * configured") says nothing about the data. A later successful answer takes it back. Answers are
 * weighed by when their requests STARTED, both ways: a late answer to an earlier request describes an
 * earlier moment and overrules nothing, as `connectivity.ts` weighs its failures.
 */

import { beginConnectivityRequest } from '@/utils/connectivity';

type Listener = () => void;

const listeners = new Set<Listener>();
let unavailable = false;
/** Start sequences (`beginConnectivityRequest`) of the latest requests answered each way. */
let lastAvailableSequence = 0;
let lastUnavailableSequence = 0;

const set = (next: boolean) => {
  if (unavailable === next) return;
  unavailable = next;
  listeners.forEach((listener) => listener());
};

/** Our server answered 503: it is there, but cannot give the person's data now. */
export const reportServerUnavailable = (requestId: number) => {
  lastUnavailableSequence = Math.max(lastUnavailableSequence, requestId);
  if (requestId < lastAvailableSequence) return;
  set(true);
};

/** Our server answered a request with success. */
export const reportServerAvailable = (requestId: number) => {
  lastAvailableSequence = Math.max(lastAvailableSequence, requestId);
  if (requestId < lastUnavailableSequence) return;
  set(false);
};

export const isServerUnavailable = (): boolean => unavailable;

/**
 * Another account now: what the server said to the previous one is not evidence for this one, and
 * after signing out nothing reads the person's data to take it back. A late refusal of a request the
 * previous account started does not bring it back (`connectivity.ts` numbers the requests).
 */
export const forgetServerAvailability = () => {
  lastAvailableSequence = Math.max(lastAvailableSequence, beginConnectivityRequest());
  set(false);
};

/** Told when the answer changes. */
export const subscribeToServerAvailability = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** Test seam: forget every answer and listener. */
export const __resetServerAvailabilityForTests = () => {
  listeners.clear();
  unavailable = false;
  lastAvailableSequence = 0;
  lastUnavailableSequence = 0;
};
