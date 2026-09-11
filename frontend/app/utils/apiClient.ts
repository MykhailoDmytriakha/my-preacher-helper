import {
  notifyUsageRequestSettled,
  throwIfUsageCapReached,
} from '@/services/usageCapClient';
import {
  beginConnectivityRequest,
  getConnectivityStatus,
  isConnectivityRequestCurrent,
  reportProbeSucceeded,
  reportServerReachable,
  reportServerUnreachable,
  subscribeToConnectivity,
} from '@/utils/connectivity';
import { debugLog } from '@/utils/debugMode';
import { fetchWithTimeout, FetchTimeoutError } from '@/utils/fetchWithTimeout';

export type RequestCategory = 'metadata' | 'detail' | 'crud' | 'ai' | 'audio' | 'health';

export interface ApiClientOptions extends RequestInit {
  category?: RequestCategory;
  timeout?: number;
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
  health: 3000,
};

/**
 * CONNECTIVITY IS NOT THIS MODULE'S JOB — it only reports what its requests observed.
 *
 * This file owned the answer for a long time, and owning it made the answer wrong: the flag
 * started at "online" and moved only when a request failed, so a session that issues no
 * requests — an app launched with the Wi-Fi off — reported a working connection for its
 * whole life. Every repair attempted on top of that needed another mechanism to compensate,
 * and each mechanism brought its own way to get stuck.
 *
 * The state now lives in `connectivity.ts`, which keeps the device signal and the server
 * signal apart. Here we do the one thing a transport can honestly say: a reply came back,
 * or the request never reached anything. Re-exported below so the ~25 existing readers keep
 * their import.
 */
export {
  getConnectivityStatus,
  getConnectivityState,
} from '@/utils/connectivity';

export const onConnectivityChange = (observer: (isOnline: boolean) => void) =>
  subscribeToConnectivity(() => observer(getConnectivityStatus()));

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
  const { category = 'crud', timeout, ...fetchOptions } = options;
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

    // Any reply — 200 or 503 — proves the network carried it. Whether the SERVER is
    // healthy is a different question, and not one connectivity should answer.
    reportServerReachable(requestId);
    await throwIfUsageCapReached(response);
    return response;
  } catch (error: unknown) {
    const err = error as Error & { name?: string };
    // A slow AI/audio operation is not evidence that unrelated reads lost their network.
    const isConnectivityError = 
      (err instanceof FetchTimeoutError && category !== 'ai' && category !== 'audio') ||
      err.message === 'Failed to fetch' ||
      err.name === 'TypeError' ||
      err.message?.includes('NetworkError');

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

/**
 * Manual probe to check server availability.
 *
 * Three current outcomes, plus a superseded result that must not update the UI. A boolean here forced two different situations into one answer
 * and produced a contradiction on screen: a 503 during a deploy made the probe return
 * "false", the toast said "still no connection", and moments later the offline icon
 * disappeared anyway — because the reply had in fact travelled, so connectivity had every
 * right to call the network fine. The network carrying a request and the server being
 * usable are different questions, and the person deserves to be told which one failed.
 */
export type ProbeOutcome = 'healthy' | 'unhealthy' | 'unreachable' | 'superseded';

export async function probeConnectivity(): Promise<ProbeOutcome> {
  const requestId = beginConnectivityRequest();
  try {
    const API_BASE = process.env.NEXT_PUBLIC_API_BASE;
    const response = await performApiRequest(`${API_BASE}/api/health`, {
      method: 'HEAD',
      category: 'health',
      /**
       * This answer is the one piece of evidence allowed to overrule the device flag, so it
       * has to come from the network every time. Without this the browser's own HTTP cache
       * can hand back a previous 204 with the Wi-Fi off, and the app would announce that
       * the connection is back having reached nothing.
       */
      cache: 'no-store',
    }, requestId);
    if (!isConnectivityRequestCurrent(requestId)) return 'superseded';
    reportProbeSucceeded(requestId);
    return response.ok ? 'healthy' : 'unhealthy';
  } catch {
    return isConnectivityRequestCurrent(requestId) ? 'unreachable' : 'superseded';
  }
}
