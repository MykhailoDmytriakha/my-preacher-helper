import {
  notifyUsageRequestSettled,
  throwIfUsageCapReached,
} from '@/services/usageCapClient';
import {
  beginConnectivityRequest,
  getConnectivityStatus,
  reportServerReachable,
  reportServerUnreachable,
  subscribeToConnectivity,
} from '@/utils/connectivity';
import { debugLog } from '@/utils/debugMode';
import { fetchWithTimeout, FetchTimeoutError } from '@/utils/fetchWithTimeout';
import { replaceMethod } from '@/utils/replaceMethod';
import { reportServerAvailable, reportServerUnavailable } from '@/utils/serverAvailability';

export type RequestCategory = 'metadata' | 'detail' | 'crud' | 'ai' | 'audio' | 'health';

export interface ApiClientOptions extends RequestInit {
  category?: RequestCategory;
  timeout?: number;
  /**
   * The route reads or writes the person's data, so its success proves the store answers and takes
   * back "server unavailable" (`utils/serverAvailability`). A route that answers without the store
   * (the knock, /api/admin/me) proves nothing about it.
   */
  answersFromStore?: boolean;
}

const TIMEOUT_BY_CATEGORY: Record<RequestCategory, number> = {
  metadata: 5000,
  detail: 15000,
  crud: 8000,
  /**
   * Deliberately ABOVE the 60s function ceiling, not aligned with it.
   *
   * Tried 65s and reverted the same day: this clock starts before `fetch` and
   * therefore measures the whole round trip — upload, edge routing, response —
   * while `maxDuration` bounds only the function's own execution. A call that used
   * 59s of legal server time plus a few seconds of overhead would be cut off by the
   * client although the server was about to answer. And `category:'ai'` is not just
   * the insight routes: sorting, plan generation, brainstorm, outline, studies
   * analysis and audio all ride it.
   */
  ai: 90000,
  // Audio requests run transcription plus follow-up AI formatting/tagging.
  // A 45s cutoff causes false offline/timeouts for valid long-running work.
  audio: 90000,
  /**
   * The knock (`connectivityKnock.ts`) — the ordinary deadline, not a short one. A 3 s probe was
   * tried in 2026-09 and could never restore a network that answers in 4 s.
   */
  health: 8000,
};

/**
 * CONNECTIVITY IS NOT THIS MODULE'S JOB — it only reports what its requests observed.
 *
 * The state lives in `connectivity.ts` (yes: the last real request reached our server). Here we do
 * the one thing a transport can honestly say: a reply came back, or the request never reached
 * anything. Re-exported below so the existing readers keep their import.
 */
export { getConnectivityStatus } from '@/utils/connectivity';

export const onConnectivityChange = (observer: (isOnline: boolean) => void) =>
  subscribeToConnectivity(() => observer(getConnectivityStatus()));

/** Failures this module saw fail to reach the server — marked where the request was made. */
const connectionFailures = new WeakSet<object>();

/** What a failed `fetch` looks like, as only this module sees it: no answer came back at all. */
const fetchDidNotReach = (err: Error & { name?: string }): boolean =>
  err instanceof FetchTimeoutError ||
  err.message === 'Failed to fetch' ||
  err.name === 'TypeError' ||
  Boolean(err.message?.includes('NetworkError'));

/**
 * DID THIS FAILURE COME FROM NOT REACHING THE SERVER — as opposed to the server answering "no"?
 *
 * Decided where the request was made, not guessed from a sentence: a service that turns a 403 into
 * `new Error('Failed to fetch share links')` is reporting an answer, and a TypeError from our own code
 * is not a network (Codex review 2026-10-11). Yes for an error `apiClient` marked as not reaching the
 * server, for a transport's `unavailable` / `deadline-exceeded`, for Firebase Auth failing to fetch a
 * token (`auth/network-request-failed`, before `apiClient` runs), and for the Firestore SDK saying the
 * client is offline.
 */
export function isConnectionFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if (connectionFailures.has(error)) return true;
  const { code, message } = error as { code?: unknown; message?: unknown };
  const bare = typeof code === 'string' ? code.replace(/^firestore\//, '') : '';
  if (bare === 'unavailable' || bare === 'deadline-exceeded' || bare === 'auth/network-request-failed') return true;
  return typeof message === 'string' && /client is offline/i.test(message);
}

/**
 * THE HEADERS CAME, THE BODY DID NOT (BUG-20261011-body-read-failure-drops-saved-copy).
 *
 * A network that drops mid-answer fails while the body is read — after this module returned the
 * response — and that failure never reached the classification above, so a refetch cut off halfway
 * dropped the saved copy of what the person had seen. Reading the body of a response this module
 * returned marks a stream failure as "did not reach" and says the connection is gone, like a failed
 * fetch. Bad JSON (`SyntaxError`) is an answer, and a body read a second time or already held by a
 * stream reader is a fault in the caller (`bodyUsed` / `body.locked` before the read): neither is a
 * network. `formData()` is not covered: its TypeError also means "this is not form data". A body that
 * ran out of time (`fetchWithTimeout` bounds the read, BUG-20261011-body-after-headers-no-deadline) is
 * "did not arrive" too — except a slow AI or audio answer, as before the headers.
 */
const BODY_READS = ['json', 'text', 'arrayBuffer', 'blob'] as const;
/** The caller's own cancel, whatever error it carries, is not the network's. */
const cancelledBy = (signal: AbortSignal | null | undefined, error: unknown): boolean =>
  Boolean(signal?.aborted) && signal?.reason === error;
function markBodyCutOff(response: Response, requestId: number, slowIsNormal: boolean, signal?: AbortSignal | null): Response {
  /**
   * Say a read that failed for want of the body. `untouched` answers, when the read fails, whether it
   * was the caller's to make — a body already used, or a reader let go of, fails for the owner's reasons.
   */
  const read = async <T,>(untouched: () => boolean, reading: () => Promise<T>): Promise<T> => {
    try {
      return await reading();
    } catch (error) {
      const outOfTime = error instanceof FetchTimeoutError && !slowIsNormal;
      if (untouched() && !cancelledBy(signal, error) && (error instanceof TypeError || outOfTime)) {
        connectionFailures.add(error);
        // Reported under the request it belongs to: a newer answer already heard wins.
        reportServerUnreachable(requestId);
      }
      throw error;
    }
  };
  // Where the response cannot take a replaced method, it is returned as it is: the mark is a help,
  // never a reason to fail a request that succeeded.
  for (const method of BODY_READS) {
    // Unused and not held by a stream reader: only then is a TypeError the network's.
    replaceMethod(response, method, whole => (() => {
      const fresh = !response.bodyUsed && !response.body?.locked;
      return read(() => fresh, whole);
    }) as typeof whole);
  }
  // A copy reads the same body, and a stream reader reads it piece by piece
  // (BUG-20261011-stream-and-clone-reads-unbounded): a cut there is the same "did not arrive".
  const markStream = () => {
    const body = response.body;
    if (!body || markedStreams.has(body)) return;
    markedStreams.add(body);
    replaceMethod(body, 'getReader', getReader => ((...args: Parameters<typeof getReader>) => {
      const reader = getReader(...args) as unknown as { read: (...pieces: unknown[]) => Promise<unknown>; releaseLock?: () => void };
      let released = false;
      replaceMethod(reader, 'releaseLock', release => () => { released = true; release!(); });
      // A read on a reader its owner let go of — before the read or while it waited — fails for the
      // owner's reasons; a read into a buffer of its own (BYOB, unused in the app) is left unmarked.
      // Only a plain read of a held reader speaks for the network.
      replaceMethod(reader, 'read', piece => (...pieces: unknown[]) => read(() => !released && pieces.every(given => given === undefined), () => piece(...pieces)));
      return reader as unknown as ReturnType<typeof getReader>;
    }) as typeof getReader);
  };
  replaceMethod(response, 'clone', clone => (() => {
    const copy = clone();
    markStream();
    return markBodyCutOff(copy, requestId, slowIsNormal, signal);
  }) as typeof clone);
  markStream();
  return response;
}

/** Streams already marked: a body that survives a copy is not wrapped twice. */
const markedStreams = new WeakSet<object>();

/**
 * High-level API client with tiered timeouts and connectivity tracking.
 */
export async function apiClient(
  url: string,
  options: ApiClientOptions = {}
): Promise<Response> {
  return performApiRequest(url, options, beginConnectivityRequest());
}

async function performApiRequest(
  url: string,
  options: ApiClientOptions,
  requestId: number
): Promise<Response> {
  const { category = 'crud', timeout, answersFromStore = false, ...fetchOptions } = options;
  const finalTimeout = timeout ?? TIMEOUT_BY_CATEGORY[category];

  try {
    const response = await fetchWithTimeout(url, {
      ...fetchOptions,
      timeout: finalTimeout,
    });

    // Handle 401 separately to signal session expiration
    if (response.status === 401) {
      debugLog('apiClient: session expired (401)', { url });
      // We don't drop connectivity on 401, but we might want a separate observer for this
      // For now, let the caller handle the redirect or retry
    }

    // Any reply — 200 or 503 — reached our server: that is "yes" (owner's rule 2). Whether the
    // route succeeded is the caller's question, not the connection's.
    reportServerReachable(requestId);
    // The store's refusal is the other half of that answer: reached, but the server could not give the
    // data — a 503 with Retry-After, which only the store guard sends. Only a success that went through
    // the store says the data is back.
    if (response.status === 503 && response.headers?.has?.('Retry-After')) reportServerUnavailable(requestId);
    else if (response.ok && answersFromStore) reportServerAvailable(requestId);
    // The usage check reads a copy of this answer: marked like any other read of it.
    const answer = markBodyCutOff(response, requestId, category === 'ai' || category === 'audio', fetchOptions.signal);
    await throwIfUsageCapReached(answer);
    // The copy stops at the caller's cancel and the check lets that pass: the cancel is the outcome.
    if (fetchOptions.signal?.aborted) throw fetchOptions.signal.reason;
    return answer;
  } catch (error: unknown) {
    const err = error as Error & { name?: string };
    // A slow AI/audio operation is not evidence that unrelated reads lost their network.
    const slowGeneration = err instanceof FetchTimeoutError && (category === 'ai' || category === 'audio');
    const isConnectivityError = !slowGeneration && !cancelledBy(fetchOptions.signal, error) && fetchDidNotReach(err);
    if (isConnectivityError && typeof error === 'object' && error !== null) connectionFailures.add(error);

    if (isConnectivityError) {
      debugLog('apiClient: connectivity issue detected', { 
        url, 
        error: err.message,
        category 
      });
      reportServerUnreachable(requestId);
    }

    throw error;
  } finally {
    if (category === 'ai' || category === 'audio') {
      notifyUsageRequestSettled();
    }
  }
}
