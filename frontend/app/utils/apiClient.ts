import { debugLog } from '@/utils/debugMode';
import { fetchWithTimeout, FetchTimeoutError } from '@/utils/fetchWithTimeout';

export type RequestCategory = 'metadata' | 'crud' | 'ai' | 'audio' | 'health';

export interface ApiClientOptions extends RequestInit {
  category?: RequestCategory;
  timeout?: number;
}

const TIMEOUT_BY_CATEGORY: Record<RequestCategory, number> = {
  metadata: 5000,
  crud: 8000,
  ai: 90000,
  audio: 45000,
  health: 3000,
};

// Internal connectivity state observers
type ConnectivityObserver = (isOnline: boolean) => void;
const observers = new Set<ConnectivityObserver>();

export const onConnectivityChange = (observer: ConnectivityObserver) => {
  observers.add(observer);
  return () => observers.delete(observer);
};

let lastKnownOnlineStatus = true;
let recoveryTimeoutId: NodeJS.Timeout | null = null;

const setOnlineStatus = (isOnline: boolean) => {
  // IF dropping to offline -> DO IT IMMEDIATELY
  if (!isOnline) {
    if (recoveryTimeoutId) {
      clearTimeout(recoveryTimeoutId);
      recoveryTimeoutId = null;
    }
    if (lastKnownOnlineStatus) {
      debugLog('apiClient: connectivity dropped', { isOnline: false });
      lastKnownOnlineStatus = false;
      observers.forEach((observer) => observer(false));
    }
    return;
  }

  // IF recovering to online -> DEBOUNCE (Hysteresis)
  // We want to be sure the network is stable before enabling "Magic"
  if (isOnline && !lastKnownOnlineStatus && !recoveryTimeoutId) {
    debugLog('apiClient: connectivity recovery detected, stabilizing...', { isOnline: true });
    recoveryTimeoutId = setTimeout(() => {
      lastKnownOnlineStatus = true;
      recoveryTimeoutId = null;
      debugLog('apiClient: connectivity stabilized', { isOnline: true });
      observers.forEach((observer) => observer(true));
    }, 3000); // Wait 3 seconds of success before confirming "Online"
  }
};

/**
 * High-level API client with tiered timeouts and connectivity tracking.
 */
export async function apiClient(
  url: string,
  options: ApiClientOptions = {}
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

    // Any successful response (even 4xx/5xx) means the server is reachable
    setOnlineStatus(true);
    return response;
  } catch (error: unknown) {
    const err = error as Error & { name?: string };
    const isConnectivityError = 
      err instanceof FetchTimeoutError || 
      err.message === 'Failed to fetch' ||
      err.name === 'TypeError' ||
      err.message?.includes('NetworkError');

    if (isConnectivityError) {
      debugLog('apiClient: connectivity issue detected', { 
        url, 
        error: err.message,
        category 
      });
      setOnlineStatus(false);
    }

    throw error;
  }
}

/**
 * Manual probe to check server availability.
 */
export async function probeConnectivity(): Promise<boolean> {
  try {
    const API_BASE = process.env.NEXT_PUBLIC_API_BASE;
    const response = await apiClient(`${API_BASE}/api/health`, {
      method: 'HEAD',
      category: 'health',
    });
    return response.ok;
  } catch {
    return false;
  }
}
